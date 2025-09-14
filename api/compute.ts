import type { NowRequest, NowResponse } from '@vercel/node';
import { assertConfig } from '../src/config';
import { computePortfolioValue } from '../src/snapshot';
import { fetchLatestSnapshot } from '../src/notion';

export default async function handler(_req: NowRequest, res: NowResponse) {
  try {
    assertConfig();
    const valuation = await computePortfolioValue();
    const last = await fetchLatestSnapshot();
    const changeUSD = typeof last?.totalUSD === 'number' ? Number((valuation.totalUSD - last.totalUSD).toFixed(2)) : undefined;
    const changePct = typeof last?.totalUSD === 'number' && last.totalUSD !== 0 ? Number(((valuation.totalUSD - last.totalUSD) / last.totalUSD * 100).toFixed(2)) : undefined;
    res.status(200).json({ valuation, last, changeUSD, changePct });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}

