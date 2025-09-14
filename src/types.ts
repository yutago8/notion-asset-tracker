export type PriceSource = 'Yahoo' | 'CoinGecko' | 'Manual';

export interface Holding {
  name: string;
  category: string;
  symbol: string; // e.g. AAPL, BTC
  quantity: number;
  priceSource: PriceSource;
  manualPrice?: number; // in USD per unit when priceSource === 'Manual'
  currency?: string; // e.g. USD, JPY (default USD)
  priceId?: string; // CoinGecko id, optional
}

export interface Snapshot {
  dateISO: string; // e.g. 2025-09-14
  totalUSD: number;
  changeUSD?: number;
  changePct?: number;
}

