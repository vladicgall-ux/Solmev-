import { config } from "./config.js";
import { logger } from "./logger.js";
import { ALL_EXCHANGES } from "./exchanges/index.js";
// Symbols ending in one of these are usually leveraged/derivative tokens
// (e.g. BTCUP, ETH3L) that some exchanges list alongside the real spot
// asset under a name that collides with our simple base-symbol matching —
// comparing their price against the real coin produces a fake "spread".
const LEVERAGED_SUFFIXES = ["UP", "DOWN", "BULL", "BEAR", "3L", "3S", "5L", "5S"];
function isLikelyLeveraged(base) {
    return LEVERAGED_SUFFIXES.some((suf) => base.endsWith(suf) && base.length > suf.length + 1);
}
export class ArbitrageScanner {
    exchanges;
    timer = null;
    lastResults = [];
    lastScanAt = null;
    lastErrors = [];
    alertedAt = new Map();
    listeners = [];
    constructor(exchangeNames = config.exchanges) {
        this.exchanges = ALL_EXCHANGES.filter((e) => exchangeNames.includes(e.name));
        if (this.exchanges.length < 2) {
            throw new Error(`Need at least 2 valid exchanges to compare (got: ${exchangeNames.join(", ") || "none"}). ` +
                `Supported: ${ALL_EXCHANGES.map((e) => e.name).join(", ")}`);
        }
    }
    isRunning() {
        return this.timer !== null;
    }
    onOpportunities(cb) {
        this.listeners.push(cb);
    }
    getLast() {
        return { results: this.lastResults, scanAt: this.lastScanAt, errors: this.lastErrors };
    }
    start() {
        if (this.timer)
            return;
        const run = () => {
            this.scanOnce().catch((err) => logger.error("scan failed", err));
        };
        run();
        this.timer = setInterval(run, config.pollIntervalSec * 1000);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async scanOnce() {
        const errors = [];
        const perExchange = await Promise.all(this.exchanges.map(async (ex) => {
            try {
                const tickers = await ex.fetchTickers(config.quoteAsset);
                return { name: ex.name, tickers };
            }
            catch (err) {
                errors.push(`${ex.name}: ${err.message}`);
                return { name: ex.name, tickers: new Map() };
            }
        }));
        const byBase = new Map();
        for (const { name, tickers } of perExchange) {
            for (const [base, t] of tickers) {
                if (isLikelyLeveraged(base))
                    continue;
                const list = byBase.get(base) ?? [];
                list.push({ exchange: name, price: t.price, quoteVolume: t.quoteVolume });
                byBase.set(base, list);
            }
        }
        const opportunities = [];
        for (const [base, quotes] of byBase) {
            if (quotes.length < 2)
                continue;
            let min = quotes[0];
            let max = quotes[0];
            for (const q of quotes) {
                if (q.price < min.price)
                    min = q;
                if (q.price > max.price)
                    max = q;
            }
            if (min.exchange === max.exchange)
                continue;
            if (min.quoteVolume < config.minVolumeUsd || max.quoteVolume < config.minVolumeUsd)
                continue;
            const spreadPct = ((max.price - min.price) / min.price) * 100;
            if (spreadPct < config.minSpreadPct || spreadPct > config.maxSpreadPct)
                continue;
            opportunities.push({
                base,
                buyExchange: min.exchange,
                buyPrice: min.price,
                sellExchange: max.exchange,
                sellPrice: max.price,
                spreadPct,
            });
        }
        opportunities.sort((a, b) => b.spreadPct - a.spreadPct);
        this.lastResults = opportunities;
        this.lastScanAt = new Date();
        this.lastErrors = errors;
        if (errors.length)
            logger.warn(`scan completed with errors: ${errors.join("; ")}`);
        logger.info(`scan: ${byBase.size} coins compared across ${this.exchanges.length} exchanges, ` +
            `${opportunities.length} opportunities >= ${config.minSpreadPct}%`);
        const fresh = this.filterFreshAlerts(opportunities);
        if (fresh.length) {
            for (const listener of this.listeners)
                listener(fresh);
        }
        return opportunities;
    }
    filterFreshAlerts(opps) {
        const now = Date.now();
        const cooldownMs = config.alertCooldownMin * 60_000;
        const fresh = [];
        for (const o of opps) {
            const key = `${o.base}:${o.buyExchange}:${o.sellExchange}`;
            const last = this.alertedAt.get(key);
            if (last && now - last < cooldownMs)
                continue;
            this.alertedAt.set(key, now);
            fresh.push(o);
        }
        return fresh;
    }
}
