import type { NowRequest, NowResponse } from '@vercel/node';
import { Client } from '@notionhq/client';
import crypto from 'crypto';
import { config } from '../src/config';

function requireWriteAuth(req: NowRequest) {
  const secret = process.env.WRITE_SECRET;
  if (!secret) return true; // no secret configured -> allow (personal use)
  const hdr = req.headers['authorization'] || '';
  const got = Array.isArray(hdr) ? hdr[0] : hdr;
  return got === `Bearer ${secret}`;
}

export default async function handler(req: NowRequest, res: NowResponse) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
    if (!requireWriteAuth(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (!config.notionToken || !config.transactionsDbId) { res.status(500).json({ error: 'NOTION_TOKEN and NOTION_TRANSACTIONS_DB_ID are required' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { title, date, amount, transactionType, dueDate, amountConfirmed, verified, paymentMethod, externalId } = body;
    if (!title || !date || typeof amount !== 'number') { res.status(400).json({ error: 'title, date, amount are required' }); return; }

    const notion = new Client({ auth: config.notionToken });
    const p = config.transactionProps;

    const ext = externalId || crypto.createHash('sha1').update(`${title}|${date}|${amount}`).digest('hex');
    // de-dup check
    try {
      const dup = await notion.databases.query({
        database_id: config.transactionsDbId,
        page_size: 1,
        filter: { property: p.externalId, rich_text: { equals: ext } } as any,
      } as any);
      if ((dup.results || []).length) {
        res.status(409).json({ error: 'duplicate', externalId: ext });
        return;
      }
    } catch (_) { /* ignore missing prop */ }

    const properties: any = {
      [p.title]: { title: [{ type: 'text', text: { content: String(title).slice(0, 2000) } }] },
      [p.date]: { date: { start: date } },
      [p.amount]: { number: amount },
      [p.amountConfirmed]: { checkbox: !!amountConfirmed },
      [p.verified]: { checkbox: !!verified },
    };
    if (dueDate) properties[p.dueDate] = { date: { start: dueDate } };
    if (transactionType) properties[p.transactionType] = { select: { name: String(transactionType) } };
    if (paymentMethod) properties[p.paymentMethod] = { select: { name: String(paymentMethod) } };
    if (p.externalId) properties[p.externalId] = { rich_text: [{ type: 'text', text: { content: ext } }] };

    const created = await notion.pages.create({ parent: { database_id: config.transactionsDbId }, properties } as any);
    res.status(200).json({ ok: true, id: (created as any).id, externalId: ext });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}

