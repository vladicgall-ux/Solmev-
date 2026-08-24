import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { buildTradeTx, PumpPortalClient } from "./pumpportal.js";
import { getWallet } from "./wallet.js";
import type { NewTokenEvent, Position, TradeEvent } from "./types.js";

export type TradeNotifier = (msg: string) => void;

export class SniperEngine {
  private connection: Connection;
  private pump: PumpPortalClient;
  private running = false;
  private initialized = false;
  private notifier: TradeNotifier | null = null;
  private positions = new Map<string, Position>();

  public snipesTaken = 0;
  public cumulativeProfitSol = 0;

  constructor() {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.pump = new PumpPortalClient();
  }

  onTrade(fn: TradeNotifier): void {
    this.notifier = fn;
  }

  private notify(msg: string): void {
    logger.trade(msg);
    this.notifier?.(msg);
  }

  isRunning(): boolean {
    return this.running;
  }

  openPositions(): Position[] {
    return [...this.positions.values()];
  }

  start(): void {
    if (this.running) return;
    if (!getWallet()) throw new Error("Cannot start: no wallet connected");
    this.running = true;

    if (!this.initialized) {
      this.initialized = true;
      this.pump.on("newToken", (event: NewTokenEvent) => {
        if (this.running) void this.handleNewToken(event);
      });
      this.pump.on("trade", (event: TradeEvent) => {
        if (this.running) void this.handleTrade(event);
      });
      this.pump.connect();
    }

    const mcapFilter = config.mcapFilterEnabled ? `<=${config.maxEntryMarketCapSol} SOL` : "off (buys any fresh launch)";
    this.notify(
      `Sniper started. dry_run=${config.dryRun} size=${config.tradeSizePctOfBalance}% of balance slots=${config.maxConcurrentPositions} ` +
        `mcap_filter=${mcapFilter} TP=+${config.takeProfitPct}% SL=-${config.stopLossPct}%`,
    );
  }

  /** Stops taking new snipes and returns a results summary; open positions are left as-is. */
  stop(): string {
    this.running = false;
    const summary =
      `Stopped. Snipes taken: ${this.snipesTaken} | ` +
      `Cumulative P&L: ${this.cumulativeProfitSol.toFixed(4)} SOL | ` +
      `Open positions left running: ${this.positions.size}`;
    this.notify(summary);
    return summary;
  }

  private async handleNewToken(event: NewTokenEvent): Promise<void> {
    if (this.positions.size >= config.maxConcurrentPositions) return;
    if (config.mcapFilterEnabled && event.marketCapSol > config.maxEntryMarketCapSol) return;
    if (this.positions.has(event.mint)) return;

    const wallet = getWallet();
    if (!wallet) return;

    try {
      await this.buy(wallet, event);
    } catch (err) {
      logger.error(`buy failed for ${event.mint}`, err);
    }
  }

  private async buy(wallet: Keypair, event: NewTokenEvent): Promise<void> {
    const label = event.symbol ?? event.mint.slice(0, 6);

    const balanceLamports = await this.connection.getBalance(wallet.publicKey, "processed");
    const spendableSol = balanceLamports / 1e9 - config.minSolReserve;
    const sizeSol = Number((spendableSol * (config.tradeSizePctOfBalance / 100)).toFixed(6));
    if (sizeSol <= 0) {
      logger.warn(`skipping ${label}: balance too low to size a trade (spendable ${spendableSol.toFixed(4)} SOL)`);
      return;
    }

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
    const position: Position = {
      mint: event.mint,
      symbol: label,
      entryMarketCapSol: event.marketCapSol,
      tokenAmount,
      costSol: sizeSol,
      openedAt: Date.now(),
    };
    this.positions.set(event.mint, position);
    this.pump.watchMint(event.mint);
    this.snipesTaken += 1;
    this.notify(`Bought ${label}: ${sizeSol} SOL @ mcap=${event.marketCapSol.toFixed(2)} SOL | tx=${sig}`);
  }

  private async handleTrade(event: TradeEvent): Promise<void> {
    const position = this.positions.get(event.mint);
    if (!position) return;

    const pctChange = (event.marketCapSol / position.entryMarketCapSol - 1) * 100;
    const hitTakeProfit = pctChange >= config.takeProfitPct;
    const hitStopLoss = pctChange <= -config.stopLossPct;
    if (!hitTakeProfit && !hitStopLoss) return;

    const wallet = getWallet();
    if (!wallet) return;

    try {
      await this.sell(wallet, position, hitTakeProfit ? "take-profit" : "stop-loss", pctChange);
    } catch (err) {
      logger.error(`sell failed for ${position.mint}`, err);
    }
  }

  private async sell(wallet: Keypair, position: Position, reason: string, pctChange: number): Promise<void> {
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
    this.pump.unwatchMint(position.mint);

    this.notify(
      `Sold ${position.symbol} (${reason}, ${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%): ` +
        `+${proceedsSol.toFixed(4)} SOL proceeds | running total: ${this.cumulativeProfitSol.toFixed(4)} SOL | tx=${sig}`,
    );
  }

  private async getTokenBalance(owner: PublicKey, mint: string): Promise<number> {
    const resp = await this.connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
    const account = resp.value[0];
    return account ? Number(account.account.data.parsed.info.tokenAmount.uiAmount ?? 0) : 0;
  }

  // Assumed compute budget for a pump.fun bonding-curve swap, used to convert
  // the network's recent microLamports/CU fee samples into a SOL amount
  // comparable to the static PRIORITY_FEE_SOL knob.
  private static readonly ASSUMED_COMPUTE_UNITS = 150_000;

  private async resolvePriorityFee(aggressive: boolean): Promise<number> {
    if (!config.dynamicPriorityFee) return config.priorityFeeSol;

    try {
      const samples = await this.connection.getRecentPrioritizationFees();
      if (samples.length === 0) return config.priorityFeeSol;

      const values = samples.map((s) => s.prioritizationFee).sort((a, b) => a - b);
      const percentile = aggressive ? 0.9 : 0.5;
      const microLamportsPerCu = values[Math.floor(values.length * percentile)] ?? 0;

      const lamports = (microLamportsPerCu * SniperEngine.ASSUMED_COMPUTE_UNITS) / 1_000_000;
      const sol = lamports / 1e9;
      return Math.min(Math.max(sol, config.minPriorityFeeSol), config.maxPriorityFeeSol);
    } catch (err) {
      logger.warn("failed to fetch recent prioritization fees, falling back to static fee", err);
      return config.priorityFeeSol;
    }
  }
}
