import type { NowRequest, NowResponse } from '@vercel/node';
import dayjs from 'dayjs';
import { assertConfig } from '../src/config';
import { computePortfolioValue } from '../src/snapshot';
import { createSnapshot, fetchLatestSnapshot } from '../src/notion';

export default async function handler(req: NowRequest, res: NowResponse) {
  try {
    // Optional protection: allow only Vercel Cron or explicit secret
    const secret = process.env.CRON_SECRET;
    const fromVercelCron = req.headers['x-vercel-cron'] !== undefined;
    if (secret && req.headers.authorization !== `Bearer ${secret}` && !fromVercelCron) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    assertConfig();
    const today = dayjs().format('YYYY-MM-DD');
    const { totalUSD } = await computePortfolioValue();
    const last = await fetchLatestSnapshot();
    const changeUSD = typeof last?.totalUSD === 'number' ? Number((totalUSD - last.totalUSD).toFixed(2)) : undefined;
    const changePct = typeof last?.totalUSD === 'number' && last.totalUSD !== 0 ? Number(((totalUSD - last.totalUSD) / last.totalUSD * 100).toFixed(2)) : undefined;
    await createSnapshot({ dateISO: today, totalUSD, changeUSD, changePct });
    res.status(200).json({ ok: true, date: today, totalUSD, changeUSD, changePct });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}

