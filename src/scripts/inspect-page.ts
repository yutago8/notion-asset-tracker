import { Client } from '@notionhq/client';
import { config } from '../config';

type PropDef = { name: string; type: string };

function hyphenate(id: string) {
  const m = id.replace(/-/g, '').match(/^[0-9a-fA-F]{32}$/);
  if (!m) return id;
  const s = m[0].toLowerCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function parsePageId(input: string): string {
  try {
    const u = new URL(input);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    const idPart = last.split('-').pop() || last; // handle pretty URLs
    return hyphenate(idPart);
  } catch {
    return hyphenate(input);
  }
}

async function listAllBlocks(notion: Client, parentId: string) {
  const results: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res = await notion.blocks.children.list({ block_id: parentId, start_cursor: cursor, page_size: 100 });
    results.push(...res.results);
    cursor = (res as any).next_cursor || undefined;
  } while (cursor);
  return results;
}

async function walkDatabases(notion: Client, rootId: string) {
  const queue: string[] = [rootId];
  const found: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const blocks = await listAllBlocks(notion, id);
    for (const b of blocks) {
      if (b.type === 'child_database') {
        found.push({ id: b.id, title: b.child_database?.title || '' });
      }
      // dive into toggles, columns, etc.
      const hasChildren = (b as any).has_children;
      if (hasChildren) queue.push(b.id);
    }
  }
  return found;
}

function listProps(db: any): PropDef[] {
  const out: PropDef[] = [];
  for (const [name, def] of Object.entries<any>(db.properties || {})) {
    out.push({ name, type: def.type || 'unknown' });
  }
  return out;
}

function checkTransactionsProps(props: PropDef[]) {
  const need: Array<{ name: string; type: string; hint?: string }> = [
    { name: 'Date', type: 'date' },
    { name: 'Amount', type: 'number' },
    { name: 'Due Date', type: 'date' },
    { name: 'Amount Confirmed', type: 'checkbox' },
    { name: 'Verified', type: 'checkbox' },
    { name: '>=10k', type: 'formula', hint: 'and(prop("Transaction Type")="Expense", abs(prop("Amount"))>=10000)' },
    { name: 'Month', type: 'formula', hint: 'formatDate(prop("Date"), "YYYY-MM")' },
    { name: 'Is Due Soon', type: 'formula', hint: 'dateBetween(prop("Due Date"), now(), dateAdd(now(), 60, "days"))' },
    { name: 'Payment Method', type: 'select' },
    { name: 'External ID', type: 'rich_text', hint: 'CSV取り込みの重複排除キー' },
  ];
  const haveIndex = new Map(props.map((p) => [p.name.toLowerCase(), p.type]));
  const missing = need.filter((n) => haveIndex.get(n.name.toLowerCase()) !== n.type);
  return { missing, have: props };
}

function checkAccountsSnapshotProps(props: PropDef[]) {
  const need: Array<{ name: string; type: string; hint?: string }>= [
    { name: 'Date', type: 'date' },
    { name: 'Account', type: 'title' },
    { name: 'Class', type: 'select', hint: 'Asset / Liability' },
    { name: 'Balance', type: 'number' },
    { name: 'Net Worth', type: 'formula', hint: 'sum(Asset)-sum(Liability) をロールアップ/ビューで表現' },
  ];
  const haveIndex = new Map(props.map((p) => [p.name.toLowerCase(), p.type]));
  const missing = need.filter((n) => haveIndex.get(n.name.toLowerCase()) !== n.type);
  return { missing, have: props };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: ts-node src/scripts/inspect-page.ts <pageIdOrUrl>');
    process.exit(1);
  }
  if (!config.notionToken) {
    console.error('NOTION_TOKEN is required in .env');
    process.exit(1);
  }
  const pageId = parsePageId(arg);
  const notion = new Client({ auth: config.notionToken });

  const page = await notion.pages.retrieve({ page_id: pageId } as any);
  const title = (page as any).properties?.title?.title?.[0]?.plain_text || '(untitled)';
  console.log(`[Page] ${title} (${pageId})`);

  const dbs = await walkDatabases(notion, pageId);
  if (!dbs.length) {
    console.log('No child databases found under this page.');
    return;
  }
  console.log(`Found ${dbs.length} databases:`);
  for (const d of dbs) {
    const db = await notion.databases.retrieve({ database_id: d.id } as any);
    const props = listProps(db);
    console.log(`\n- ${d.title} (${d.id})`);
    for (const p of props) console.log(`  * ${p.name} (${p.type})`);

    const titleLower = d.title.toLowerCase();
    if (titleLower.includes('transaction')) {
      const check = checkTransactionsProps(props);
      if (check.missing.length) {
        console.log('  Suggested additions for Transactions:');
        for (const m of check.missing) console.log(`    - ${m.name} : ${m.type}${m.hint ? `  // ${m.hint}` : ''}`);
      } else {
        console.log('  Transactions: looks complete.');
      }
    }
    if (titleLower.includes('account') || titleLower.includes('snapshot')) {
      const check = checkAccountsSnapshotProps(props);
      if (check.missing.length) {
        console.log('  Suggested additions for Accounts Snapshot:');
        for (const m of check.missing) console.log(`    - ${m.name} : ${m.type}${m.hint ? `  // ${m.hint}` : ''}`);
      } else {
        console.log('  Accounts Snapshot: looks complete.');
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

