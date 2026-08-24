import "dotenv/config";
function parseList(v, fallback) {
    if (!v)
        return fallback;
    const list = v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return list.length ? list : fallback;
}
export const config = {
    exchanges: parseList(process.env.EXCHANGES, ["binance", "bybit", "okx", "kucoin", "gateio", "mexc", "bitget"]),
    quoteAsset: (process.env.QUOTE_ASSET ?? "USDT").toUpperCase(),
    pollIntervalSec: Number(process.env.POLL_INTERVAL_SEC ?? "30"),
    minSpreadPct: Number(process.env.MIN_SPREAD_PCT ?? "1"),
    maxSpreadPct: Number(process.env.MAX_SPREAD_PCT ?? "50"),
    minVolumeUsd: Number(process.env.MIN_VOLUME_USD ?? "50000"),
    alertCooldownMin: Number(process.env.ALERT_COOLDOWN_MIN ?? "15"),
    topListSize: Number(process.env.TOP_LIST_SIZE ?? "15"),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    telegramOwnerId: process.env.TELEGRAM_OWNER_ID ?? "",
};
