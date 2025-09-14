import { Client } from '@notionhq/client';
import { config } from './config';
import type { Holding, Snapshot, Transaction } from './types';

const notion = new Client({ auth: config.notionToken });

const titlePropCache = new Map<string, string | undefined>();
async function getTitlePropForDb(dbId: string): Promise<string | undefined> {
  if (titlePropCache.has(dbId)) return titlePropCache.get(dbId)!;
  try {
    const db = await notion.databases.retrieve({ database_id: dbId } as any);
    const props = (db as any).properties || {};
    for (const [name, def] of Object.entries<any>(props)) {
      if ((def as any)?.type === 'title') {
        titlePropCache.set(dbId, name);
        return name;
      }
    }
  } catch {}
  titlePropCache.set(dbId, undefined);
  return undefined;
}

function getTitlePlainText(page: any, propName: string): string {
  const prop = page.properties?.[propName];
  const arr = prop?.title || [];
  return arr.map((t: any) => t.plain_text).join('').trim();
}

function getRichTextPlainText(page: any, propName: string): string {
  const prop = page.properties?.[propName];
  const arr = prop?.rich_text || [];
  return arr.map((t: any) => t.plain_text).join('').trim();
}

function getSelectName(page: any, propName: string): string {
  const prop = page.properties?.[propName];
  return (prop?.select?.name || '').trim();
}

function getNumber(page: any, propName: string): number | undefined {
  const prop = page.properties?.[propName];
  const v = prop?.number;
  return typeof v === 'number' ? v : undefined;
}

function getCheckbox(page: any, propName: string): boolean {
  const prop = page.properties?.[propName];
  return !!prop?.checkbox;
}

function getDate(page: any, propName: string): string | undefined {
  const prop = page.properties?.[propName];
  const start = prop?.date?.start as string | undefined;
  return start || undefined;
}

export async function fetchHoldings(): Promise<Holding[]> {
  const props = config.props;
  const items: Holding[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res = await notion.databases.query({
      database_id: config.holdingsDbId,
      start_cursor: cursor,
      page_size: 100,
      sorts: [
        { property: props.category, direction: 'ascending' },
        { property: props.name, direction: 'ascending' as const },
      ],
    } as any);

    for (const page of res.results as any[]) {
      const name = getTitlePlainText(page, props.name);
      const category = getSelectName(page, props.category);
      const symbol = getRichTextPlainText(page, props.symbol) || name;
      const quantity = getNumber(page, props.quantity) || 0;
      const priceSource = (getSelectName(page, props.priceSource) || 'Yahoo') as Holding['priceSource'];
      const manualPrice = getNumber(page, props.manualPrice);
      const currency = (getSelectName(page, props.currency) || 'USD').toUpperCase();
      const priceId = getRichTextPlainText(page, props.priceId) || undefined;

      if (!name || quantity <= 0) continue;
      items.push({ name, category, symbol, quantity, priceSource, manualPrice, currency, priceId });
    }

    cursor = (res as any).next_cursor || undefined;
  } while (cursor);

  return items;
}

export async function fetchRecentSnapshots(limit = 90): Promise<Snapshot[]> {
  const p = config.snapshotProps;
  const res = await notion.databases.query({
    database_id: config.snapshotsDbId,
    sorts: [{ property: p.date, direction: 'descending' }],
    page_size: limit,
  } as any);

  const items: Snapshot[] = [];
  for (const page of res.results as any[]) {
    const date = page.properties?.[p.date]?.date?.start as string | undefined;
    const total = page.properties?.[p.totalUSD]?.number as number | undefined;
    const chUsd = page.properties?.[p.changeUSD]?.number as number | undefined;
    const chPct = page.properties?.[p.changePct]?.number as number | undefined;
    if (!date || typeof total !== 'number') continue;
    items.push({ dateISO: date, totalUSD: total, changeUSD: chUsd, changePct: chPct });
  }
  return items.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

export async function fetchLatestSnapshot(): Promise<Snapshot | undefined> {
  const arr = await fetchRecentSnapshots(1);
  return arr[arr.length - 1];
}

export async function createSnapshot(s: Snapshot) {
  const p = config.snapshotProps;
  const titleProp = await getTitlePropForDb(config.snapshotsDbId);
  await notion.pages.create({
    parent: { database_id: config.snapshotsDbId },
    properties: {
      ...(titleProp ? { [titleProp]: { title: [{ type: 'text', text: { content: `Snapshot ${s.dateISO}` } }] } } : {}),
      [p.date]: { date: { start: s.dateISO } },
      [p.totalUSD]: { number: s.totalUSD },
      ...(typeof s.changeUSD === 'number' ? { [p.changeUSD]: { number: s.changeUSD } } : {}),
      ...(typeof s.changePct === 'number' ? { [p.changePct]: { number: s.changePct } } : {}),
    },
  } as any);
}

export async function fetchAssetLog(limit = 365, from?: string, to?: string) {
  if (!config.assetLogDbId) throw new Error('NOTION_ASSET_LOG_DB_ID is not set');
  const p = config.assetLogProps;
  const filter: any = from || to ? { and: [] as any[] } : undefined;
  if (from) (filter.and as any[]).push({ property: p.date, date: { on_or_after: from } });
  if (to) (filter.and as any[]).push({ property: p.date, date: { on_or_before: to } });
  const res = await notion.databases.query({ database_id: config.assetLogDbId, page_size: limit, sorts: [{ property: p.date, direction: 'ascending' }], filter } as any);
  const items: Array<{ dateISO: string; change: number; mode?: string }> = [];
  for (const page of res.results as any[]) {
    const date = page.properties?.[p.date]?.date?.start as string | undefined;
    const ch = page.properties?.[p.change]?.number as number | undefined;
    const mode = page.properties?.[p.mode]?.select?.name as string | undefined;
    if (!date || typeof ch !== 'number') continue;
    items.push({ dateISO: date, change: ch, mode });
  }
  return items;
}

export async function upsertAssetLogEntry(dateISO: string, change: number, mode?: 'Cash' | 'Forecast') {
  if (!config.assetLogDbId) throw new Error('NOTION_ASSET_LOG_DB_ID is not set');
  const p = config.assetLogProps;
  // find existing
  const existing = await notion.databases.query({
    database_id: config.assetLogDbId,
    page_size: 1,
    filter: { property: p.date, date: { equals: dateISO } } as any,
  } as any);
  const titleProp = await getTitlePropForDb(config.assetLogDbId);
  const props: any = {
    [p.date]: { date: { start: dateISO } },
    [p.change]: { number: change },
    ...(mode ? { [p.mode]: { select: { name: mode } } } : {}),
    ...(titleProp ? { [titleProp]: { title: [{ type: 'text', text: { content: `Change ${dateISO}` } }] } } : {}),
  };
  if ((existing.results || []).length) {
    const pageId = (existing.results as any[])[0].id as string;
    await notion.pages.update({ page_id: pageId, properties: props } as any);
    return pageId;
  } else {
    const created = await notion.pages.create({ parent: { database_id: config.assetLogDbId }, properties: props } as any);
    return (created as any).id as string;
  }
}

export async function fetchTransactions(limit = 1000): Promise<Transaction[]> {
  if (!config.transactionsDbId) throw new Error('NOTION_TRANSACTIONS_DB_ID is not set');
  const p = config.transactionProps;
  const items: Transaction[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res = await notion.databases.query({
      database_id: config.transactionsDbId,
      start_cursor: cursor,
      page_size: 100,
      sorts: [
        { property: p.date, direction: 'descending' as const },
      ],
    } as any);
    for (const page of res.results as any[]) {
      const id = page.id as string;
      const title = getTitlePlainText(page, p.title) || '(untitled)';
      const date = getDate(page, p.date);
      const amount = getNumber(page, p.amount) ?? 0;
      const amountConfirmed = getCheckbox(page, p.amountConfirmed);
      const verified = getCheckbox(page, p.verified);
      const dueDate = getDate(page, p.dueDate);
      const transactionType = getSelectName(page, p.transactionType) || undefined;
      const paymentMethod = getSelectName(page, p.paymentMethod) || undefined;
      if (!date) continue;
      items.push({ id, title, date, amount, amountConfirmed, verified, dueDate, transactionType, paymentMethod });
      if (items.length >= limit) break;
    }
    cursor = (res as any).next_cursor || undefined;
  } while (cursor && items.length < limit);
  return items;
}
