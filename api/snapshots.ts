import type { NowRequest, NowResponse } from '@vercel/node';
import { assertConfig } from '../src/config';
import { fetchRecentSnapshots } from '../src/notion';

export default async function handler(req: NowRequest, res: NowResponse) {
  try {
    assertConfig();
    const limit = Math.min(parseInt(String((req.query as any).limit || '90'), 10) || 90, 365);
    const items = await fetchRecentSnapshots(limit);
    res.status(200).json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}

