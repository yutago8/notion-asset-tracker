import { fetchHoldings } from './notion';
import { getCoinGeckoPrices } from './priceProviders/coinGecko';
import { getYahooPrices } from './priceProviders/yahoo';
import { toBase } from './fx';
import { config } from './config';
import type { Holding } from './types';

export interface PortfolioValuation {
  // NOTE: Values are in the configured base currency (config.baseCurrency)
  totalUSD: number; // kept for backward-compat with existing API shape
  byAsset: Array<{ name: string; symbol: string; valueUSD: number; quantity: number }>;
}

export async function computePortfolioValue(): Promise<PortfolioValuation> {
  const holdings = await fetchHoldings();
  const yahooSymbols: string[] = [];
  const geckoIds: string[] = [];

  for (const h of holdings) {
    if (h.priceSource === 'Yahoo') yahooSymbols.push(h.symbol);
    else if (h.priceSource === 'CoinGecko') geckoIds.push((h.priceId || h.symbol).toLowerCase());
  }

  const [yahooMap, geckoMap] = await Promise.all([
    getYahooPrices(yahooSymbols),
    getCoinGeckoPrices(geckoIds, config.baseCurrency.toLowerCase()),
  ]);

  let totalUSD = 0; // actually base currency amount
  const byAsset: PortfolioValuation['byAsset'] = [];

  for (const h of holdings) {
    let unitRaw: number | undefined;
    let unitCurrency: string = (h.currency || 'USD').toUpperCase();
    if (h.priceSource === 'Manual') {
      unitRaw = h.manualPrice;
      // If no currency set for Manual, assume base currency to reduce surprises
      unitCurrency = (h.currency || config.baseCurrency).toUpperCase();
    } else if (h.priceSource === 'Yahoo') {
      unitRaw = yahooMap.get(h.symbol);
      // Expect user to set Currency (e.g., JPY for 9984.T). Default remains USD.
    } else if (h.priceSource === 'CoinGecko') {
      const key = (h.priceId || h.symbol).toLowerCase();
      unitRaw = geckoMap.get(key);
      // CoinGecko already returns base currency price for requested vs.
      unitCurrency = config.baseCurrency.toUpperCase();
    }
    if (typeof unitRaw !== 'number' || unitRaw <= 0) continue;

    // Convert to base currency when needed
    let unitInBase = unitRaw;
    if (unitCurrency.toUpperCase() !== config.baseCurrency.toUpperCase()) {
      unitInBase = await toBase(unitRaw, unitCurrency);
    }

    const valueUSD = unitInBase * h.quantity; // naming kept for API compatibility
    totalUSD += valueUSD;
    byAsset.push({ name: h.name, symbol: h.symbol, valueUSD, quantity: h.quantity });
  }

  return { totalUSD: round2(totalUSD), byAsset: byAsset.sort((a, b) => b.valueUSD - a.valueUSD) };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
