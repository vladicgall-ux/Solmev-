import { Connection, PublicKey, VersionedTransaction, } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { buildTradeTx, PumpPortalClient } from "./pumpportal.js";
import { getWallet } from "./wallet.js";
// The classic (non-Token-2022) SPL Token program id — used to enumerate ALL
// token balances in the wallet for the panic sell-all, not just ones this
// process happens to be tracking.
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
// Positions are persisted here so an ordinary process restart (crash,
// panel bounce) doesn't "forget" open positions while the wallet still
// holds the tokens — that mismatch is what let past buys blow through
// MAX_CONCURRENT_POSITIONS across restarts. A full redeploy that wipes the
// filesystem will still lose this; use 🧹 Продать всё to recover from that.
const POSITIONS_FILE = "positions.json";
export class SniperEngine {
    connection;
    pump;
    running = false;
    initialized = false;
    notifier = null;
    positions = new Map();
    snipesTaken = 0;
    cumulativeProfitSol = 0;
    insufficientBalanceWarned = false;
    constructor() {
        this.connection = new Connection(config.rpcUrl, "confirmed");
        this.pump = new PumpPortalClient();
        this.loadPersistedPositions();
    }
    loadPersistedPositions() {
        if (!existsSync(POSITIONS_FILE))
            return;
        try {
            const raw = JSON.parse(readFileSync(POSITIONS_FILE, "utf8"));
            for (const p of raw)
                this.positions.set(p.mint, p);
            if (raw.length > 0)
                logger.info(`Restored ${raw.length} position(s) from ${POSITIONS_FILE}`);
        }
        catch (err) {
            logger.error(`failed to read ${POSITIONS_FILE}`, err);
        }
    }
    persistPositions() {
        try {
            writeFileSync(POSITIONS_FILE, JSON.stringify([...this.positions.values()], null, 2));
        }
        catch (err) {
            logger.error(`failed to write ${POSITIONS_FILE}`, err);
        }
    }
    onTrade(fn) {
        this.notifier = fn;
    }
    notify(msg) {
        logger.trade(msg);
        this.notifier?.(msg);
    }
    isRunning() {
        return this.running;
    }
    openPositions() {
        return [...this.positions.values()];
    }
    start() {
        if (this.running)
            return;
        if (!getWallet())
            throw new Error("Cannot start: no wallet connected");
        this.running = true;
        if (!this.initialized) {
            this.initialized = true;
            this.pump.on("newToken", (event) => {
                if (this.running)
                    void this.handleNewToken(event);
            });
            this.pump.on("trade", (event) => {
                if (this.running)
                    void this.handleTrade(event);
            });
            this.pump.connect();
            // Resume live-trade tracking for any positions restored from disk.
            for (const p of this.positions.values())
                this.pump.watchMint(p.mint);
        }
        const mcapFilter = config.mcapFilterEnabled ? `<=${config.maxEntryMarketCapSol} SOL` : "off (buys any fresh launch)";
        this.notify(`Sniper started. dry_run=${config.dryRun} size=${config.tradeSizePctOfBalance}% of balance slots=${config.maxConcurrentPositions} ` +
            `mcap_filter=${mcapFilter} TP=+${config.takeProfitPct}% SL=-${config.stopLossPct}%`);
    }
    /** Stops taking new snipes and returns a results summary; open positions are left as-is. */
    stop() {
        this.running = false;
        const summary = `Stopped. Snipes taken: ${this.snipesTaken} | ` +
            `Cumulative P&L: ${this.cumulativeProfitSol.toFixed(4)} SOL | ` +
            `Open positions left running: ${this.positions.size}`;
        this.notify(summary);
        return summary;
    }
    async handleNewToken(event) {
        if (this.positions.size >= config.maxConcurrentPositions)
            return;
        if (config.mcapFilterEnabled && event.marketCapSol > config.maxEntryMarketCapSol)
            return;
        if (this.positions.has(event.mint))
            return;
        const wallet = getWallet();
        if (!wallet)
            return;
        try {
            await this.buy(wallet, event);
        }
        catch (err) {
            logger.error(`buy failed for ${event.mint}`, err);
        }
    }
    // A buy has to fund a brand-new associated token account (~0.002 SOL rent)
    // on top of the swap itself — below this, the transaction can't land at
    // all even though the naive "% of balance" math comes out positive.
    static MIN_VIABLE_TRADE_SOL = 0.004;
    async buy(wallet, event) {
        const label = event.symbol ?? event.mint.slice(0, 6);
        const balanceLamports = await this.connection.getBalance(wallet.publicKey, "processed");
        const balanceSol = balanceLamports / 1e9;
        const spendableSol = balanceSol - config.minSolReserve;
        const sizeSol = Number((spendableSol * (config.tradeSizePctOfBalance / 100)).toFixed(6));
        if (sizeSol < SniperEngine.MIN_VIABLE_TRADE_SOL) {
            logger.warn(`skipping ${label}: balance too low to size a trade (spendable ${spendableSol.toFixed(4)} SOL)`);
            if (!this.insufficientBalanceWarned) {
                this.insufficientBalanceWarned = true;
                const neededSol = config.minSolReserve + SniperEngine.MIN_VIABLE_TRADE_SOL / (config.tradeSizePctOfBalance / 100);
                this.notify(`⚠️ Баланс ${balanceSol.toFixed(4)} SOL слишком мал для сделки при текущих настройках ` +
                    `(${config.tradeSizePctOfBalance}% от баланса даёт ~${Math.max(sizeSol, 0).toFixed(5)} SOL на сделку, ` +
                    `а покупка нового токена требует минимум ~${SniperEngine.MIN_VIABLE_TRADE_SOL} SOL на аренду аккаунта). ` +
                    `Пополни кошелёк минимум до ~${neededSol.toFixed(3)} SOL, либо подними % размера сделки в ⚙️ Настройки. ` +
                    `Это сообщение больше не повторится, пока баланс не станет достаточным.`);
            }
            return;
        }
        this.insufficientBalanceWarned = false;
        logger.trade(`sniping ${label} (${event.mint}) mcap=${event.marketCapSol.toFixed(2)} SOL, size=${sizeSol} SOL`);
        const priorityFeeSol = await this.resolvePriorityFee(/* aggressive */ true);
        const txBytes = await buildTradeTx({
            publicKey: wallet.publicKey.toBase58(),
            action: "buy",
            mint: event.mint,
            amount: sizeSol,
            denominatedInSol: true,
            slippagePct: config.slippagePct,
            priorityFeeSol,
        });
        const tx = VersionedTransaction.deserialize(txBytes);
        tx.sign([wallet]);
        // Fast mode skips this simulate round trip on the live path — the whole
        // point is winning the race to land before the token moves. In dry-run
        // we always simulate anyway, since there's no race to lose and the
        // feedback is the point.
        if (config.dryRun || !config.fastMode) {
            const sim = await this.connection.simulateTransaction(tx, { sigVerify: false });
            if (sim.value.err) {
                logger.warn(`simulation failed for buy ${label}`, sim.value.err, sim.value.logs);
                return;
            }
        }
        if (config.dryRun) {
            logger.info(`DRY_RUN — would buy ${label} for ${sizeSol} SOL (priority fee ${priorityFeeSol} SOL)`);
            return;
        }
        const sig = await this.connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: config.fastMode,
            maxRetries: 3,
        });
        await this.connection.confirmTransaction(sig, "confirmed");
        const tokenAmount = await this.getTokenBalance(wallet.publicKey, event.mint);
        const position = {
            mint: event.mint,
            symbol: label,
            entryMarketCapSol: event.marketCapSol,
            tokenAmount,
            costSol: sizeSol,
            openedAt: Date.now(),
        };
        this.positions.set(event.mint, position);
        this.persistPositions();
        this.pump.watchMint(event.mint);
        this.snipesTaken += 1;
        this.notify(`Bought ${label}: ${sizeSol} SOL @ mcap=${event.marketCapSol.toFixed(2)} SOL | tx=${sig}`);
    }
    async handleTrade(event) {
        const position = this.positions.get(event.mint);
        if (!position)
            return;
        const pctChange = (event.marketCapSol / position.entryMarketCapSol - 1) * 100;
        const hitTakeProfit = pctChange >= config.takeProfitPct;
        const hitStopLoss = pctChange <= -config.stopLossPct;
        if (!hitTakeProfit && !hitStopLoss)
            return;
        const wallet = getWallet();
        if (!wallet)
            return;
        try {
            await this.sell(wallet, position, hitTakeProfit ? "take-profit" : "stop-loss", pctChange);
        }
        catch (err) {
            logger.error(`sell failed for ${position.mint}`, err);
        }
    }
    async sell(wallet, position, reason, pctChange) {
        // Exiting isn't a race against other bots the way a snipe entry is, so
        // sells stay on the cheap end of recent fees by default and always get
        // simulated first — a botched sell wastes the position, not just a fee.
        const priorityFeeSol = await this.resolvePriorityFee(/* aggressive */ false);
        const txBytes = await buildTradeTx({
            publicKey: wallet.publicKey.toBase58(),
            action: "sell",
            mint: position.mint,
            amount: "100%",
            denominatedInSol: false,
            slippagePct: config.slippagePct,
            priorityFeeSol,
        });
        const tx = VersionedTransaction.deserialize(txBytes);
        tx.sign([wallet]);
        const sim = await this.connection.simulateTransaction(tx, { sigVerify: false });
        if (sim.value.err) {
            logger.warn(`simulation failed for sell ${position.symbol}`, sim.value.err, sim.value.logs);
            return;
        }
        if (config.dryRun) {
            logger.info(`DRY_RUN — would sell ${position.symbol} (${reason}, ${pctChange.toFixed(1)}%)`);
            this.positions.delete(position.mint);
            this.persistPositions();
            this.pump.unwatchMint(position.mint);
            return;
        }
        const balanceBefore = await this.connection.getBalance(wallet.publicKey);
        const sig = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
        await this.connection.confirmTransaction(sig, "confirmed");
        const balanceAfter = await this.connection.getBalance(wallet.publicKey);
        const proceedsSol = (balanceAfter - balanceBefore) / 1e9;
        const pnlSol = proceedsSol; // balanceBefore already excludes the original buy cost, spent earlier
        this.cumulativeProfitSol += pnlSol;
        this.positions.delete(position.mint);
        this.persistPositions();
        this.pump.unwatchMint(position.mint);
        this.notify(`Sold ${position.symbol} (${reason}, ${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%): ` +
            `+${proceedsSol.toFixed(4)} SOL proceeds | running total: ${this.cumulativeProfitSol.toFixed(4)} SOL | tx=${sig}`);
    }
    async getTokenBalance(owner, mint) {
        const resp = await this.connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
        const account = resp.value[0];
        return account ? Number(account.account.data.parsed.info.tokenAmount.uiAmount ?? 0) : 0;
    }
    /**
     * Liquidates every SPL token balance actually sitting in the wallet,
     * whether or not this process has it tracked as a "position" — recovery
     * tool for when tracking and real holdings have drifted apart (e.g. after
     * positions were bought under a since-restarted process). Ignores
     * dry-run and fast-mode: this is an explicit, one-off user action.
     */
    async sellAllHoldings(wallet) {
        const resp = await this.connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
            programId: TOKEN_PROGRAM_ID,
        });
        const held = resp.value
            .map((a) => ({
            mint: a.account.data.parsed.info.mint,
            uiAmount: Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
        }))
            .filter((t) => t.uiAmount > 0);
        if (held.length === 0)
            return "В кошельке нет токенов на продажу.";
        const balanceBefore = await this.connection.getBalance(wallet.publicKey);
        const results = [];
        for (const { mint } of held) {
            try {
                const priorityFeeSol = await this.resolvePriorityFee(false);
                const txBytes = await buildTradeTx({
                    publicKey: wallet.publicKey.toBase58(),
                    action: "sell",
                    mint,
                    amount: "100%",
                    denominatedInSol: false,
                    slippagePct: config.slippagePct,
                    priorityFeeSol,
                });
                const tx = VersionedTransaction.deserialize(txBytes);
                tx.sign([wallet]);
                const sim = await this.connection.simulateTransaction(tx, { sigVerify: false });
                if (sim.value.err) {
                    results.push(`❌ ${mint.slice(0, 6)}.. — не продалось (симуляция: ${JSON.stringify(sim.value.err)})`);
                    continue;
                }
                const sig = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
                await this.connection.confirmTransaction(sig, "confirmed");
                results.push(`✅ ${mint.slice(0, 6)}.. продан`);
            }
            catch (err) {
                results.push(`❌ ${mint.slice(0, 6)}.. — ошибка: ${err.message}`);
            }
            const position = this.positions.get(mint);
            if (position) {
                this.positions.delete(mint);
                this.pump.unwatchMint(mint);
            }
        }
        this.persistPositions();
        const balanceAfter = await this.connection.getBalance(wallet.publicKey);
        const proceedsSol = (balanceAfter - balanceBefore) / 1e9;
        this.cumulativeProfitSol += proceedsSol;
        return (`Продажа всего (${held.length} токен(ов)):\n` +
            results.join("\n") +
            `\n\nИтого получено: ${proceedsSol.toFixed(4)} SOL`);
    }
    // Assumed compute budget for a pump.fun bonding-curve swap, used to convert
    // the network's recent microLamports/CU fee samples into a SOL amount
    // comparable to the static PRIORITY_FEE_SOL knob.
    static ASSUMED_COMPUTE_UNITS = 150_000;
    async resolvePriorityFee(aggressive) {
        if (!config.dynamicPriorityFee)
            return config.priorityFeeSol;
        try {
            const samples = await this.connection.getRecentPrioritizationFees();
            if (samples.length === 0)
                return config.priorityFeeSol;
            const values = samples.map((s) => s.prioritizationFee).sort((a, b) => a - b);
            const percentile = aggressive ? 0.9 : 0.5;
            const microLamportsPerCu = values[Math.floor(values.length * percentile)] ?? 0;
            const lamports = (microLamportsPerCu * SniperEngine.ASSUMED_COMPUTE_UNITS) / 1_000_000;
            const sol = lamports / 1e9;
            return Math.min(Math.max(sol, config.minPriorityFeeSol), config.maxPriorityFeeSol);
        }
        catch (err) {
            logger.warn("failed to fetch recent prioritization fees, falling back to static fee", err);
            return config.priorityFeeSol;
        }
    }
}
