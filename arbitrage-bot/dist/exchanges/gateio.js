import { fetchJson } from "../http.js";
export const name = "gateio";
export async function fetchTickers(quote) {
    const data = await fetchJson("https://api.gateio.ws/api/v4/spot/tickers");
    const out = new Map();
    for (const t of data) {
        const [base, q] = t.currency_pair.split("_");
        if (q !== quote || !base)
            continue;
        const price = Number(t.last);
        if (!Number.isFinite(price) || price <= 0)
            continue;
        const quoteVolume = Number(t.quote_volume);
        out.set(base, { price, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
    }
    return out;
}
