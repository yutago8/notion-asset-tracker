import type { NowRequest, NowResponse } from '@vercel/node';
import { Client } from '@notionhq/client';
import { config } from '../src/config';

export default async function handler(_req: NowRequest, res: NowResponse) {
  try {
    if (!config.notionToken || !config.transactionsDbId) {
      res.status(500).json({ error: 'NOTION_TOKEN and NOTION_TRANSACTIONS_DB_ID are required' });
      return;
    }
    const notion = new Client({ auth: config.notionToken });
    const db = await notion.databases.retrieve({ database_id: config.transactionsDbId } as any);
    const props: any = (db as any).properties || {};
    const pm = props[config.transactionProps.paymentMethod];
    const tt = props[config.transactionProps.transactionType];
    const paymentMethods = pm?.select?.options?.map((o: any) => o.name).filter(Boolean) || [];
    const transactionTypes = tt?.select?.options?.map((o: any) => o.name).filter(Boolean) || [];
    res.status(200).json({ paymentMethods, transactionTypes });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}

