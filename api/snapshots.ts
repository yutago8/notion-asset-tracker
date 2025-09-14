import type { NowRequest, NowResponse } from '@vercel/node';
import { config } from '../src/config';
import { fetchRecentSnapshots } from '../src/notion';

export default async function handler(req: NowRequest, res: NowResponse) {
  try {
    if (!config.notionToken || !config.snapshotsDbId) {
      res.status(500).json({ error: 'NOTION_TOKEN and NOTION_SNAPSHOTS_DB_ID are required' });
      return;
    }
    const limit = Math.min(parseInt(String((req.query as any).limit || '90'), 10) || 90, 365);
    const items = await fetchRecentSnapshots(limit);
    res.status(200).json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
