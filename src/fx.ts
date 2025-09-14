import axios from 'axios';
import { config } from './config';

// Cache FX rates for 30 minutes per currency pair.
const cache = new Map<string, { rate: number; ts: number }>();

async function getFxRate(from: string, to: string): Promise<number> {
  const f = (from || 'USD').toUpperCase();
  const t = (to || 'USD').toUpperCase();
  if (f === t) return 1;
  const key = `${f}_${t}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.ts < 1000 * 60 * 30) return cached.rate;
  const url = 'https://api.exchangerate.host/latest';
  const { data } = await axios.get(url, { params: { base: f, symbols: t }, timeout: 10000 });
  const rate = data?.rates?.[t]; // 1 f = rate t
  if (typeof rate !== 'number' || rate <= 0) throw new Error(`FX rate not available ${f}->${t}`);
  cache.set(key, { rate, ts: now });
  return rate;
}

export async function convert(amount: number, from: string, to: string): Promise<number> {
  const rate = await getFxRate(from, to);
  return amount * rate;
}

export async function toUSD(amount: number, currency: string): Promise<number> {
  const cur = (currency || 'USD').toUpperCase();
  return convert(amount, cur, 'USD');
}

export async function toBase(amount: number, currency: string): Promise<number> {
  const cur = (currency || config.baseCurrency).toUpperCase();
  const base = config.baseCurrency.toUpperCase();
  return convert(amount, cur, base);
}

export { getFxRate };
