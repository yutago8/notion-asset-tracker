import type { NowRequest, NowResponse } from '@vercel/node';
import dayjs from 'dayjs';
import { config } from '../src/config';
import { fetchTransactions } from '../src/notion';

export default async function handler(req: NowRequest, res: NowResponse) {
  try {
    if (!config.notionToken || !config.transactionsDbId) {
      res.status(500).json({ error: 'NOTION_TOKEN and NOTION_TRANSACTIONS_DB_ID are required' });
      return;
    }
    const limit = Math.min(parseInt(String((req.query as any).limit || '1000'), 10) || 1000, 2000);
    const items = await fetchTransactions(limit);
    const now = dayjs();
    const enriched = items.map((t) => {
      const month = dayjs(t.date).format('YYYY-MM');
      const isDueSoon = t.dueDate ? (dayjs(t.dueDate).diff(now, 'day') >= 0 && dayjs(t.dueDate).diff(now, 'day') <= 60) : false;
      const isExpense = (t.transactionType || '').toLowerCase() === 'expense' || (t.transactionType || '').includes('支出');
      const gte10k = Math.abs(t.amount) >= 10000 && isExpense;
      return { ...t, month, isDueSoon, isExpense, gte10k };
    });
    res.status(200).json({ items: enriched });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}

