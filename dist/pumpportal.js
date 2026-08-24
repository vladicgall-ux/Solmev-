import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { logger } from "./logger.js";
const WS_URL = "wss://pumpportal.fun/api/data";
const TRADE_LOCAL_URL = "https://pumpportal.fun/api/trade-local";
/**
 * Thin wrapper around PumpPortal's public data feed. Emits 'newToken' for
 * every pump.fun token creation and 'trade' for live trades on mints we've
 * asked to watch (used to track price/marketCap of open positions).
 */
export class PumpPortalClient extends EventEmitter {
    ws = null;
    watchedMints = new Set();
    reconnectDelayMs = 1000;
    connect() {
        this.ws = new WebSocket(WS_URL);
        this.ws.on("open", () => {
            logger.info("PumpPortal WS connected");
            this.reconnectDelayMs = 1000;
            this.send({ method: "subscribeNewToken" });
            if (this.watchedMints.size > 0) {
                this.send({ method: "subscribeTokenTrade", keys: [...this.watchedMints] });
            }
        });
        this.ws.on("message", (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                this.handleMessage(msg);
            }
            catch (err) {
                logger.warn("failed to parse PumpPortal message", err);
            }
        });
        this.ws.on("close", () => {
            logger.warn(`PumpPortal WS closed, reconnecting in ${this.reconnectDelayMs}ms`);
            setTimeout(() => this.connect(), this.reconnectDelayMs);
            this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
        });
        this.ws.on("error", (err) => {
            logger.error("PumpPortal WS error", err);
        });
    }
    handleMessage(msg) {
        if (msg.txType === "create" && msg.mint) {
            const event = {
                mint: msg.mint,
                name: msg.name,
                symbol: msg.symbol,
                marketCapSol: Number(msg.marketCapSol ?? 0),
                vSolInBondingCurve: msg.vSolInBondingCurve,
                vTokensInBondingCurve: msg.vTokensInBondingCurve,
            };
            this.emit("newToken", event);
            return;
        }
        if ((msg.txType === "buy" || msg.txType === "sell") && msg.mint) {
            const event = { mint: msg.mint, marketCapSol: Number(msg.marketCapSol ?? 0) };
            this.emit("trade", event);
        }
    }
    watchMint(mint) {
        if (this.watchedMints.has(mint))
            return;
        this.watchedMints.add(mint);
        this.send({ method: "subscribeTokenTrade", keys: [mint] });
    }
    unwatchMint(mint) {
        if (!this.watchedMints.has(mint))
            return;
        this.watchedMints.delete(mint);
        this.send({ method: "unsubscribeTokenTrade", keys: [mint] });
    }
    send(payload) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }
}
/**
 * Asks PumpPortal to build the (unsigned) bonding-curve buy/sell transaction.
 * Non-custodial: it never sees a private key, only returns raw tx bytes we
 * sign and send ourselves.
 */
export async function buildTradeTx(params) {
    const res = await fetch(TRADE_LOCAL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            publicKey: params.publicKey,
            action: params.action,
            mint: params.mint,
            amount: params.amount,
            denominatedInSol: params.denominatedInSol ? "true" : "false",
            slippage: params.slippagePct,
            priorityFee: params.priorityFeeSol,
            pool: "pump",
        }),
    });
    if (!res.ok) {
        throw new Error(`PumpPortal trade-local failed: ${res.status} ${await res.text()}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
}
