import express from 'express';
import path from 'path';
import { assertConfig, config } from './config';
import { fetchRecentSnapshots, fetchLatestSnapshot } from './notion';
import { computePortfolioValue } from './snapshot';

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({ baseCurrency: config.baseCurrency });
});

app.get('/api/snapshots', async (req, res) => {
  try {
    assertConfig();
    const limit = Math.min(parseInt(String(req.query.limit || '90'), 10) || 90, 365);
    const items = await fetchRecentSnapshots(limit);
    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'unknown error' });
  }
});

app.get('/api/compute', async (_req, res) => {
  try {
    assertConfig();
    const valuation = await computePortfolioValue();
    const last = await fetchLatestSnapshot();
    const changeUSD = typeof last?.totalUSD === 'number' ? Number((valuation.totalUSD - last.totalUSD).toFixed(2)) : undefined;
    const changePct = typeof last?.totalUSD === 'number' && last.totalUSD !== 0 ? Number(((valuation.totalUSD - last.totalUSD) / last.totalUSD * 100).toFixed(2)) : undefined;
    res.json({ valuation, last, changeUSD, changePct });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'unknown error' });
  }
});

// Static UI
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  console.log(`[server] base currency: ${config.baseCurrency}`);
});
