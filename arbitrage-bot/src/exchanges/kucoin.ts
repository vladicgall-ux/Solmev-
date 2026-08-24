import { fetchJson } from "../http.js";
import type { ExchangeQuote } from "../types.js";

interface KucoinResponse {
  data?: { ticker?: { symbol: string; last: string | null; volValue: string }[] };
}

export const name = "kucoin";

export async function fetchTickers(quote: string): Promise<Map<string, ExchangeQuote>> {
  const data = await fetchJson<KucoinResponse>("https://api.kucoin.com/api/v1/market/allTickers");
  const out = new Map<string, ExchangeQuote>();
  for (const t of data.data?.ticker ?? []) {
    const [base, q] = t.symbol.split("-");
    if (q !== quote || !base || t.last == null) continue;
    const price = Number(t.last);
    if (!Number.isFinite(price) || price <= 0) continue;
    const quoteVolume = Number(t.volValue);
    out.set(base, { price, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
  }
  return out;
}
