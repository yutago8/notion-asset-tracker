import axios from 'axios';

export async function getCoinGeckoPrices(ids: string[], vs: string = 'usd'): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!ids.length) return map;
  const unique = Array.from(new Set(ids.filter(Boolean).map((s) => s.toLowerCase())));
  const url = `https://api.coingecko.com/api/v3/simple/price`;
  const params = { ids: unique.join(','), vs_currencies: vs } as const;
  const { data } = await axios.get(url, { params, timeout: 10000 });
  for (const id of unique) {
    const price = data?.[id]?.[vs];
    if (typeof price === 'number') map.set(id, price);
  }
  return map;
}

