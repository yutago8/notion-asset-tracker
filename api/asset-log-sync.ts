import type { NowRequest, NowResponse } from '@vercel/node';
import dayjs from 'dayjs';
import { config } from '../src/config';
import { fetchTransactions, upsertAssetLogEntry } from '../src/notion';

function authorized(req: NowRequest) {
  const secret = process.env.WRITE_SECRET;
  if (!secret) return true;
  const hdr = req.headers['authorization'] || '';
  const got = Array.isArray(hdr) ? hdr[0] : hdr;
  return got === `Bearer ${secret}`;
}

export default async function handler(req: NowRequest, res: NowResponse) {
  try {
    if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (!config.notionToken || !config.transactionsDbId || !config.assetLogDbId) {
      res.status(500).json({ error: 'NOTION_TOKEN, NOTION_TRANSACTIONS_DB_ID, NOTION_ASSET_LOG_DB_ID are required' });
      return;
    }
    const q = req.query as any;
    const mode = (String(q.mode || 'cash').toLowerCase() === 'forecast') ? 'Forecast' : 'Cash';
    const now = dayjs();
    const from = q.from ? dayjs(String(q.from)) : now.subtract(90, 'day');
    const to = q.to ? dayjs(String(q.to)) : now;
    const items = await fetchTransactions(2000);
    const byDate = new Map<string, number>();
    for (const t of items) {
      const inRange = dayjs(t.date).isAfter(from.subtract(1, 'day')) && dayjs(t.date).isBefore(to.add(1, 'day'));
      if (!inRange) continue;
      const ok = mode === 'Cash' ? t.verified : t.amountConfirmed;
      if (!ok) continue;
      const key = t.date;
      byDate.set(key, (byDate.get(key) || 0) + (t.amount || 0));
    }
    const writes: Array<{ date: string; change: number }> = [];
    for (const [date, change] of byDate.entries()) {
      if (!change) continue;
      await upsertAssetLogEntry(date, change, mode);
      writes.push({ date, change });
    }
    res.status(200).json({ ok: true, mode, from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD'), count: writes.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}

