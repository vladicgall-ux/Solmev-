import { fetchJson } from "../http.js";
export const name = "bitget";
export async function fetchTickers(quote) {
    const data = await fetchJson("https://api.bitget.com/api/v2/spot/market/tickers");
    const out = new Map();
    for (const t of data.data ?? []) {
        if (!t.symbol.endsWith(quote))
            continue;
        const base = t.symbol.slice(0, -quote.length);
        if (!base)
            continue;
        const price = Number(t.lastPr);
        if (!Number.isFinite(price) || price <= 0)
            continue;
        const quoteVolume = Number(t.quoteVolume);
        out.set(base, { price, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
    }
    return out;
}
