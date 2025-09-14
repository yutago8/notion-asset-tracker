import { Client } from '@notionhq/client';
import { config } from './config';
import type { Holding, Snapshot } from './types';

const notion = new Client({ auth: config.notionToken });

let snapshotTitlePropCache: string | undefined;
async function getSnapshotTitleProp(): Promise<string | undefined> {
  if (snapshotTitlePropCache !== undefined) return snapshotTitlePropCache;
  try {
    const db = await notion.databases.retrieve({ database_id: config.snapshotsDbId } as any);
    const props = (db as any).properties || {};
    for (const [name, def] of Object.entries<any>(props)) {
      if (def?.type === 'title') {
        snapshotTitlePropCache = name;
        return name;
      }
    }
  } catch {
    // ignore
  }
  snapshotTitlePropCache = undefined;
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
  const titleProp = await getSnapshotTitleProp();
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
