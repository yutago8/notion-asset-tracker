import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@notionhq/client';

type TxProps = {
  date: string; amount: string; confirmed: string; verified: string; paymentMethod: string; assetType: string;
};
type LogProps = { date: string; assetType: string; number: string };

function env(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing env ${name}`);
  return v as string;
}

function getTxProps(): TxProps {
  return {
    date: process.env.TR_PROP_DATE || 'Date',
    amount: process.env.TR_PROP_AMOUNT || 'Amount',
    confirmed: process.env.TR_PROP_AMOUNT_CONFIRMED || 'Amount Confirmed',
    verified: process.env.TR_PROP_VERIFIED || 'Verified',
    paymentMethod: process.env.TR_PROP_PAYMENT_METHOD || 'Payment Method',
    assetType: process.env.TR_PROP_ASSET_TYPE || 'Asset Type',
  };
}

function getLogProps(): LogProps {
  return {
    date: process.env.ALOG_PROP_DATE || 'Date',
    assetType: process.env.ALOG_PROP_ASSET_TYPE || 'Asset Type',
    number: process.env.ALOG_PROP_NUMBER || 'Number',
  };
}

function toISODate(s?: string | null): string | undefined {
  if (!s) return undefined;
  try { return new Date(s).toISOString().slice(0,10); } catch { return undefined; }
}

export async function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}

export async function POST(req: NextRequest) {
  try {
    const secret = env('WEBHOOK_SECRET');
    const got = req.headers.get('x-webhook-secret') || '';
    if (secret && got !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const NOTION_TOKEN = env('NOTION_TOKEN');
    const TRANSACTIONS_DB_ID = env('TRANSACTIONS_DB_ID');
    const ASSET_LOG_DB_ID = env('ASSET_LOG_DB_ID');

    const notion = new Client({ auth: NOTION_TOKEN });
    const txp = getTxProps();
    const lgp = getLogProps();
    const body = await req.json().catch(() => ({} as any));
    const pageId: string | undefined = body?.page_id;

    // Determine time range to recalc
    let fromISO: string | undefined;
    let toISO: string | undefined;
    let targetAssetType: string | undefined;
    if (pageId) {
      try {
        const page = await notion.pages.retrieve({ page_id: pageId } as any);
        const date = (page as any).properties?.[txp.date]?.date?.start as string | undefined;
        const aType = (page as any).properties?.[txp.assetType]?.select?.name as string | undefined;
        const base = toISODate(date) || new Date().toISOString().slice(0,10);
        const d = new Date(base);
        const from = new Date(d); from.setDate(d.getDate() - 30);
        const to = new Date(d); to.setDate(d.getDate() + 30);
        fromISO = from.toISOString().slice(0,10);
        toISO = to.toISOString().slice(0,10);
        targetAssetType = aType;
      } catch {
        /* ignore */
      }
    }
    if (!fromISO) {
      const to = new Date();
      const from = new Date(); from.setDate(to.getDate() - 180);
      fromISO = from.toISOString().slice(0,10);
      toISO = to.toISOString().slice(0,10);
    }

    // Fetch transactions in range
    const aggregateBy = (process.env.AGGREGATE_BY || 'asset_type').toLowerCase(); // 'asset_type' | 'payment_method' | 'total'
    const txItems = await fetchTransactions(notion, TRANSACTIONS_DB_ID, txp, fromISO, toISO);

    // Aggregate by date + assetType
    const key = (d: string, a: string) => `${d}|${a}`;
    const daily = new Map<string, { date: string; assetType: string; change: number }>();
    const groupOf = (t: TxItem) => {
      if (aggregateBy === 'asset_type') return t.assetType || 'Unknown';
      if (aggregateBy === 'payment_method') return t.paymentMethod || 'Unknown';
      return 'Total';
    };
    for (const t of txItems) {
      const date = t.date;
      const asset = groupOf(t);
      const k = key(date, asset);
      const cur = daily.get(k) || { date, assetType: asset, change: 0 };
      cur.change += t.amount; // 支出はマイナス、収入はプラスの前提
      daily.set(k, cur);
    }
    // Build cumulative balance per group with starting balance before fromISO
    const startBalances = await fetchStartingBalances(notion, TRANSACTIONS_DB_ID, txp, fromISO, aggregateBy);
    const byType = new Map<string, Array<{ date: string; change: number }>>();
    for (const v of daily.values()) {
      const arr = byType.get(v.assetType) || [];
      arr.push({ date: v.date, change: v.change });
      byType.set(v.assetType, arr);
    }
    const entries: Array<{ date: string; assetType: string; number: number; balance: number }> = [];
    for (const [asset, arr0] of byType.entries()) {
      const arr = arr0.sort((a,b)=> a.date.localeCompare(b.date));
      let bal = startBalances.get(asset) || 0;
      for (const d of arr) {
        bal += d.change;
        entries.push({ date: d.date, assetType: asset, number: round2(d.change), balance: round2(bal) });
      }
    }

    // Upsert into Asset Log (fetch existing in range to reduce queries)
    // Ensure Asset Log has Balance property if configured
    const balanceProp = process.env.ALOG_PROP_BALANCE || 'Balance';
    await ensureAssetLogProps(notion, ASSET_LOG_DB_ID, { ...lgp, balance: balanceProp });

    const existing = await fetchAssetLogRange(notion, ASSET_LOG_DB_ID, { ...lgp, balance: balanceProp }, fromISO, toISO);
    const existingKey = new Map<string, string>(); // key -> page_id
    for (const e of existing) existingKey.set(key(e.date, e.assetType), e.id);

    const results: Array<{ date: string; assetType: string; id: string }> = [];
    for (const e of entries) {
      const k = key(e.date, e.assetType);
      const id = existingKey.get(k);
      const props: any = {
        [lgp.date]: { date: { start: e.date } },
        [lgp.assetType]: { select: { name: e.assetType } },
        [lgp.number]: { number: e.number },
        [balanceProp]: { number: e.balance },
      };
      if (id) {
        await notion.pages.update({ page_id: id, properties: props } as any);
        results.push({ date: e.date, assetType: e.assetType, id });
      } else {
        const created = await notion.pages.create({ parent: { database_id: ASSET_LOG_DB_ID }, properties: props } as any);
        const newId = (created as any).id as string;
        existingKey.set(k, newId);
        results.push({ date: e.date, assetType: e.assetType, id: newId });
      }
    }

    return NextResponse.json({ ok: true, from: fromISO, to: toISO, updated: results.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'unknown error' }, { status: 500 });
  }
}

function round2(n: number) { return Math.round(n * 100) / 100; }

type TxItem = { date: string; amount: number; paymentMethod?: string; assetType?: string };

async function fetchTransactions(
  notion: Client,
  dbId: string,
  p: TxProps,
  fromISO?: string,
  toISO?: string
) {
  const items: Array<TxItem> = [];
  let cursor: string | undefined;
  const filters: any[] = [];
  if (fromISO) filters.push({ property: p.date, date: { on_or_after: fromISO } });
  if (toISO) filters.push({ property: p.date, date: { on_or_before: toISO } });
  // Only confirmed or verified
  const flagFilter = { or: [ { property: p.confirmed, checkbox: { equals: true } }, { property: p.verified, checkbox: { equals: true } } ] };
  const baseFilter = filters.length ? { and: [flagFilter, ...filters] } : flagFilter;

  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
      filter: baseFilter as any,
      sorts: [{ property: p.date, direction: 'ascending' }],
    } as any);
    for (const page of (res.results as any[])) {
      const date = toISODate(page?.properties?.[p.date]?.date?.start) as string | undefined;
      const amt = page?.properties?.[p.amount]?.number as number | undefined;
      const pm = page?.properties?.[p.paymentMethod]?.select?.name as string | undefined;
      const at = page?.properties?.[p.assetType]?.select?.name as string | undefined;
      if (!date || typeof amt !== 'number' || !isFinite(amt)) continue;
      items.push({ date, amount: amt, paymentMethod: pm, assetType: at });
    }
    cursor = (res as any).next_cursor || undefined;
  } while (cursor);
  return items;
}

async function fetchAssetLogRange(
  notion: Client,
  dbId: string,
  p: LogProps & { balance: string },
  fromISO?: string,
  toISO?: string
) {
  const items: Array<{ id: string; date: string; assetType: string }> = [];
  let cursor: string | undefined;
  const and: any[] = [];
  if (fromISO) and.push({ property: p.date, date: { on_or_after: fromISO } });
  if (toISO) and.push({ property: p.date, date: { on_or_before: toISO } });
  const filter = and.length ? { and } : undefined;
  do {
    const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor, page_size: 100, filter } as any);
    for (const page of (res.results as any[])) {
      const date = toISODate(page?.properties?.[p.date]?.date?.start);
      const assetType = page?.properties?.[p.assetType]?.select?.name as string | undefined;
      if (!date || !assetType) continue;
      items.push({ id: page.id as string, date, assetType });
    }
    cursor = (res as any).next_cursor || undefined;
  } while (cursor);
  return items;
}

async function fetchStartingBalances(
  notion: Client,
  txDbId: string,
  p: TxProps,
  fromISO?: string,
  aggregateBy: 'asset_type'|'payment_method'|'total' = 'asset_type'
) {
  const map = new Map<string, number>();
  if (!fromISO) return map;
  // day before fromISO
  const d = new Date(fromISO);
  d.setDate(d.getDate() - 1);
  const prevTo = d.toISOString().slice(0,10);
  const tx = await fetchTransactions(notion, txDbId, p, undefined, prevTo);
  for (const t of tx) {
    const key = aggregateBy === 'asset_type' ? (t.assetType || 'Unknown') : (aggregateBy === 'payment_method' ? (t.paymentMethod || 'Unknown') : 'Total');
    map.set(key, (map.get(key) || 0) + t.amount);
  }
  return map;
}

async function ensureAssetLogProps(
  notion: Client,
  dbId: string,
  p: LogProps & { balance: string },
) {
  try {
    const db = await notion.databases.retrieve({ database_id: dbId } as any);
    const props = (db as any).properties || {};
    const hasNumber = !!props[p.number];
    const hasAssetType = !!props[p.assetType];
    const hasBalance = !!props[p.balance];
    if (!hasBalance) {
      await notion.databases.update({ database_id: dbId, properties: { [p.balance]: { number: {} } } } as any);
    }
    // If missing Number/Asset Type we don't auto-add (既存スキーマが異なる場合は.envで上書き)
  } catch {
    /* ignore */
  }
}
