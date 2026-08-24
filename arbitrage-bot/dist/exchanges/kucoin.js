import { fetchJson } from "../http.js";
export const name = "kucoin";
export async function fetchTickers(quote) {
    const data = await fetchJson("https://api.kucoin.com/api/v1/market/allTickers");
    const out = new Map();
    for (const t of data.data?.ticker ?? []) {
        const [base, q] = t.symbol.split("-");
        if (q !== quote || !base || t.last == null)
            continue;
        const price = Number(t.last);
        if (!Number.isFinite(price) || price <= 0)
            continue;
        const quoteVolume = Number(t.volValue);
        out.set(base, { price, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
    }
    return out;
}
