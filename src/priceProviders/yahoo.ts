import axios from 'axios';

// Fetch prices from Yahoo Finance quote endpoint (unofficial)
// symbols: e.g. ["AAPL","MSFT","VOO","9984.T"]
export async function getYahooPrices(symbols: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = Array.from(new Set(symbols.filter(Boolean)));
  if (!unique.length) return map;
  const endpoint = 'https://query1.finance.yahoo.com/v7/finance/quote';
  const { data } = await axios.get(endpoint, {
    params: { symbols: unique.join(',') },
    timeout: 10000,
  });
  const results = data?.quoteResponse?.result || [];
  for (const r of results) {
    const sym = r?.symbol;
    const price = r?.regularMarketPrice ?? r?.postMarketPrice ?? r?.preMarketPrice;
    if (sym && typeof price === 'number') {
      map.set(sym, price);
    }
  }
  return map;
}

