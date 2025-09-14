import dayjs from 'dayjs';
import { assertConfig } from '../config';
import { computePortfolioValue } from '../snapshot';
import { createSnapshot, fetchLatestSnapshot } from '../notion';

async function main() {
  assertConfig();
  const today = dayjs().format('YYYY-MM-DD');
  const { totalUSD } = await computePortfolioValue();
  const last = await fetchLatestSnapshot();
  const changeUSD = typeof last?.totalUSD === 'number' ? Number((totalUSD - last.totalUSD).toFixed(2)) : undefined;
  const changePct = typeof last?.totalUSD === 'number' && last.totalUSD !== 0 ? Number(((totalUSD - last.totalUSD) / last.totalUSD * 100).toFixed(2)) : undefined;
  await createSnapshot({ dateISO: today, totalUSD, changeUSD, changePct });
  console.log(`[snapshot] ${today} totalUSD=${totalUSD} changeUSD=${changeUSD} changePct=${changePct}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

