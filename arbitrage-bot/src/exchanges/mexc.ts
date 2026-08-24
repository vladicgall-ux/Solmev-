import { fetchJson } from "../http.js";
import type { ExchangeQuote } from "../types.js";

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  quoteVolume: string;
}

export const name = "mexc";

export async function fetchTickers(quote: string): Promise<Map<string, ExchangeQuote>> {
  const data = await fetchJson<Ticker24h[]>("https://api.mexc.com/api/v3/ticker/24hr");
  const out = new Map<string, ExchangeQuote>();
  for (const t of data) {
    if (!t.symbol.endsWith(quote)) continue;
    const base = t.symbol.slice(0, -quote.length);
    if (!base) continue;
    const price = Number(t.lastPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    const quoteVolume = Number(t.quoteVolume);
    out.set(base, { price, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
  }
  return out;
}
