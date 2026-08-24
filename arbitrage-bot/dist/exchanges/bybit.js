import { fetchJson } from "../http.js";
export const name = "bybit";
export async function fetchTickers(quote) {
    const data = await fetchJson("https://api.bybit.com/v5/market/tickers?category=spot");
    const out = new Map();
    for (const t of data.result?.list ?? []) {
        if (!t.symbol.endsWith(quote))
            continue;
        const base = t.symbol.slice(0, -quote.length);
        if (!base)
            continue;
        const price = Number(t.lastPrice);
        if (!Number.isFinite(price) || price <= 0)
            continue;
        const quoteVolume = Number(t.turnover24h);
        out.set(base, { price, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
    }
    return out;
}
