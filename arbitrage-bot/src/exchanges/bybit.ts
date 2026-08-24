import { fetchJson } from "../http.js";
import type { ExchangeQuote } from "../types.js";

interface BybitResponse {
  result?: { list?: { symbol: string; lastPrice: string; turnover24h: string }[] };
}

export const name = "bybit";

export async function fetchTickers(quote: string): Promise<Map<string, ExchangeQuote>> {
  const data = await fetchJson<BybitResponse>("https://api.bybit.com/v5/market/tickers?category=spot");
  const out = new Map<string, ExchangeQuote>();
  for (const t of data.result?.list ?? []) {
    if (!t.symbol.endsWith(quote)) continue;
    const base = t.symbol.slice(0, -quote.length);
    if (!base) continue;
    const price = Number(t.lastPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    const quoteVolume = Number(t.turnover24h);
    out.set(base, { price, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
  }
  return out;
}
