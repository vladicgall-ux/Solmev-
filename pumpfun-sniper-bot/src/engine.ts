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

    this.pump.on("newToken", (event: NewTokenEvent) => {
      if (this.running) void this.handleNewToken(event);
    });
    this.pump.on("trade", (event: TradeEvent) => {
      if (this.running) void this.handleTrade(event);
    });
    this.pump.connect();

    this.notify(
      `Sniper started. dry_run=${config.dryRun} size=${config.tradeSizeSol} SOL ` +
        `max_entry_mcap=${config.maxEntryMarketCapSol} SOL TP=+${config.takeProfitPct}% SL=-${config.stopLossPct}%`,
    );
  }

  stop(): void {
    this.running = false;
    this.notify("Sniper stopped (existing positions are left open, not force-sold).");
  }

  private async handleNewToken(event: NewTokenEvent): Promise<void> {
    if (this.positions.size >= config.maxConcurrentPositions) return;
    if (event.marketCapSol > config.maxEntryMarketCapSol) return;
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
    logger.trade(`sniping ${label} (${event.mint}) mcap=${event.marketCapSol.toFixed(2)} SOL`);

    const txBytes = await buildTradeTx({
      publicKey: wallet.publicKey.toBase58(),
      action: "buy",
      mint: event.mint,
      amount: config.tradeSizeSol,
      denominatedInSol: true,
      slippagePct: config.slippagePct,
      priorityFeeSol: config.priorityFeeSol,
    });
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([wallet]);

    const sim = await this.connection.simulateTransaction(tx, { sigVerify: false });
    if (sim.value.err) {
      logger.warn(`simulation failed for buy ${label}`, sim.value.err, sim.value.logs);
      return;
    }

    if (config.dryRun) {
      logger.info(`DRY_RUN — would buy ${label} for ${config.tradeSizeSol} SOL`);
      return;
    }

    const sig = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(sig, "confirmed");

    const tokenAmount = await this.getTokenBalance(wallet.publicKey, event.mint);
    const position: Position = {
      mint: event.mint,
      symbol: label,
      entryMarketCapSol: event.marketCapSol,
      tokenAmount,
      costSol: config.tradeSizeSol,
      openedAt: Date.now(),
    };
    this.positions.set(event.mint, position);
    this.pump.watchMint(event.mint);
    this.snipesTaken += 1;
    this.notify(`Bought ${label}: ${config.tradeSizeSol} SOL @ mcap=${event.marketCapSol.toFixed(2)} SOL | tx=${sig}`);
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
    const txBytes = await buildTradeTx({
      publicKey: wallet.publicKey.toBase58(),
      action: "sell",
      mint: position.mint,
      amount: "100%",
      denominatedInSol: false,
      slippagePct: config.slippagePct,
      priorityFeeSol: config.priorityFeeSol,
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
    const sig = await this.connection.sendRawTransaction(tx.serialize());
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
}
