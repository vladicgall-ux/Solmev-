import { fetchJson } from "../http.js";
export const name = "okx";
export async function fetchTickers(quote) {
    const data = await fetchJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
    const out = new Map();
    for (const t of data.data ?? []) {
        const [base, q] = t.instId.split("-");
        if (q !== quote || !base)
            continue;
        const price = Number(t.last);
        if (!Number.isFinite(price) || price <= 0)
            continue;
        const quoteVolume = Number(t.volCcy24h);
        out.set(base, { price, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
    }
    return out;
}
