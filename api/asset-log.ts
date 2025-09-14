import type { NowRequest, NowResponse } from '@vercel/node';
import { config } from '../src/config';
import { fetchAssetLog } from '../src/notion';

export default async function handler(req: NowRequest, res: NowResponse) {
  try {
    if (!config.notionToken || !config.assetLogDbId) {
      res.status(500).json({ error: 'NOTION_TOKEN and NOTION_ASSET_LOG_DB_ID are required' });
      return;
    }
    const q = req.query as any;
    const from = typeof q.from === 'string' ? q.from : undefined;
    const to = typeof q.to === 'string' ? q.to : undefined;
    const limit = Math.min(parseInt(String(q.limit || '365'), 10) || 365, 2000);
    const items = await fetchAssetLog(limit, from, to);
    res.status(200).json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}

