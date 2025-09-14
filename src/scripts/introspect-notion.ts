import { Client } from '@notionhq/client';
import { config } from '../config';

type PropDef = { name: string; type: string; options?: string[] };

function norm(s: string) {
  return s.toLowerCase();
}

function listProps(db: any): PropDef[] {
  const props = db.properties || {};
  const out: PropDef[] = [];
  for (const [name, def] of Object.entries<any>(props)) {
    const type = def?.type || 'unknown';
    const options = def?.[type]?.options?.map((o: any) => o.name)?.filter(Boolean);
    out.push({ name, type, options });
  }
  return out;
}

function guessHoldings(props: PropDef[]) {
  const find = (pred: (p: PropDef) => boolean, ...aliases: string[]) => {
    const aliasSet = new Set(aliases.map(norm));
    return (
      props.find((p) => aliasSet.has(norm(p.name))) ||
      props.find((p) => aliases.some((a) => norm(p.name).includes(norm(a)))) ||
      props.find(pred)
    );
  };

  const title = props.find((p) => p.type === 'title');
  const name = find((p) => p.type === 'title', 'Name', 'タイトル');
  const category = find((p) => p.type === 'select', 'Category', 'カテゴリ', 'Asset Class');
  const symbol = find((p) => ['rich_text', 'title'].includes(p.type), 'Symbol', 'Ticker', 'ティッカー', '銘柄コード');
  const quantity = find((p) => p.type === 'number', 'Quantity', 'Qty', '数量', '保有数量', '株数');
  const priceSource = find((p) => p.type === 'select', 'Price Source', '価格ソース', 'Source');
  const manualPrice = find((p) => p.type === 'number', 'Manual Price', '手動価格');
  const currency = find((p) => ['select', 'rich_text'].includes(p.type), 'Currency', '通貨');
  const priceId = find((p) => p.type === 'rich_text', 'Price ID', 'CoinGecko', 'ID');

  return {
    name: name?.name || title?.name,
    category: category?.name,
    symbol: symbol?.name,
    quantity: quantity?.name,
    priceSource: priceSource?.name,
    manualPrice: manualPrice?.name,
    currency: currency?.name,
    priceId: priceId?.name,
  };
}

function guessSnapshots(props: PropDef[]) {
  const find = (pred: (p: PropDef) => boolean, ...aliases: string[]) => {
    const aliasSet = new Set(aliases.map(norm));
    return (
      props.find((p) => aliasSet.has(norm(p.name))) ||
      props.find((p) => aliases.some((a) => norm(p.name).includes(norm(a)))) ||
      props.find(pred)
    );
  };
  const date = find((p) => p.type === 'date', 'Date', '日付');
  const total = find((p) => p.type === 'number', 'Total USD', 'Total', 'Total JPY', '評価額');
  const change = find((p) => p.type === 'number', 'Change USD', 'Change', 'Change JPY', '変化額');
  const changePct = find((p) => p.type === 'number', 'Change %', 'Change Pct', '変化率', '割合');
  return {
    date: date?.name,
    totalUSD: total?.name,
    changeUSD: change?.name,
    changePct: changePct?.name,
  };
}

async function fetchSamplePages(notion: Client, database_id: string, limit = 5) {
  const res = await notion.databases.query({ database_id, page_size: limit } as any);
  return res.results as any[];
}

function renderPropSummary(props: PropDef[]): string {
  const rows = props
    .map((p) => `- ${p.name} (${p.type}${p.options?.length ? `: ${p.options.join(', ')}` : ''})`)
    .join('\n');
  return rows || '(no properties)';
}

async function introspectDb(notion: Client, id: string, label: string) {
  const db = await notion.databases.retrieve({ database_id: id } as any);
  console.log(`\n[${label}] ${db.title?.[0]?.plain_text || ''}`);
  console.log(`id: ${db.id}`);
  const props = listProps(db);
  console.log('properties:');
  console.log(renderPropSummary(props));
  const pages = await fetchSamplePages(notion, id, 5);
  console.log(`sample pages: ${pages.length}`);
  return { db, props };
}

async function main() {
  if (!config.notionToken) {
    console.error('NOTION_TOKEN is required. Please set it in .env');
    process.exit(1);
  }
  const notion = new Client({ auth: config.notionToken });

  console.log(`Base currency: ${config.baseCurrency}`);

  let holdingsProps: PropDef[] | undefined;
  let snapshotsProps: PropDef[] | undefined;

  if (config.holdingsDbId) {
    const { props } = await introspectDb(notion, config.holdingsDbId, 'Holdings');
    holdingsProps = props;
  } else {
    console.log('\n[Holdings] NOTION_HOLDINGS_DB_ID is not set. Trying search...');
    const search = await notion.search({ query: 'Holdings', page_size: 10, filter: { value: 'database', property: 'object' } as any } as any);
    const cand = (search.results as any[]).find((r) => r.object === 'database');
    if (cand) {
      console.log(`Found candidate DB: ${cand.title?.[0]?.plain_text || ''} (${cand.id})`);
    } else {
      console.log('No database found by search. Please provide NOTION_HOLDINGS_DB_ID.');
    }
  }

  if (config.snapshotsDbId) {
    const { props } = await introspectDb(notion, config.snapshotsDbId, 'Snapshots');
    snapshotsProps = props;
  } else {
    console.log('\n[Snapshots] NOTION_SNAPSHOTS_DB_ID is not set. Trying search...');
    const search = await notion.search({ query: 'Snapshots', page_size: 10, filter: { value: 'database', property: 'object' } as any } as any);
    const cand = (search.results as any[]).find((r) => r.object === 'database');
    if (cand) {
      console.log(`Found candidate DB: ${cand.title?.[0]?.plain_text || ''} (${cand.id})`);
    } else {
      console.log('No database found by search. Please provide NOTION_SNAPSHOTS_DB_ID.');
    }
  }

  if (holdingsProps) {
    const guess = guessHoldings(holdingsProps);
    console.log('\n[Holdings] Suggested .env property mapping:');
    console.log(`PROP_NAME=${guess.name ?? ''}`);
    console.log(`PROP_CATEGORY=${guess.category ?? ''}`);
    console.log(`PROP_SYMBOL=${guess.symbol ?? ''}`);
    console.log(`PROP_QUANTITY=${guess.quantity ?? ''}`);
    console.log(`PROP_PRICE_SOURCE=${guess.priceSource ?? ''}`);
    console.log(`PROP_MANUAL_PRICE=${guess.manualPrice ?? ''}`);
    console.log(`PROP_CURRENCY=${guess.currency ?? ''}`);
    console.log(`PROP_PRICE_ID=${guess.priceId ?? ''}`);
  }

  if (snapshotsProps) {
    const guess = guessSnapshots(snapshotsProps);
    console.log('\n[Snapshots] Suggested .env property mapping:');
    console.log(`SNAPSHOT_PROP_DATE=${guess.date ?? ''}`);
    console.log(`SNAPSHOT_PROP_TOTAL_USD=${guess.totalUSD ?? ''}`);
    console.log(`SNAPSHOT_PROP_CHANGE_USD=${guess.changeUSD ?? ''}`);
    console.log(`SNAPSHOT_PROP_CHANGE_PCT=${guess.changePct ?? ''}`);
  }

  console.log('\nDone. If suggestions look correct, copy them into your .env');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

