import { Connection } from "@solana/web3.js";
import { config } from "./config.js";
import { findBestOpportunity } from "./scanner.js";
import { executeOpportunity } from "./executor.js";
import { getWallet } from "./wallet.js";
import { logger } from "./logger.js";

export type TradeNotifier = (msg: string) => void;

export class TradingEngine {
  private connection: Connection;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private notifier: TradeNotifier | null = null;

  public tradesExecuted = 0;
  public cumulativeProfitLamports = 0n;

  constructor() {
    this.connection = new Connection(config.rpcUrl, "confirmed");
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

  start(): void {
    if (this.running) return;
    if (!getWallet()) {
      throw new Error("Cannot start: no wallet connected");
    }
    this.running = true;
    this.loopPromise = this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    this.notify(
      `Engine started. dry_run=${config.dryRun} min_profit_bps=${config.minProfitBps} ` +
        `pairs=${config.pairs.length} dexes=${config.dexes.join(",")}`,
    );

    while (this.running) {
      const wallet = getWallet();
      if (!wallet) {
        this.notify("Wallet disconnected mid-run — stopping.");
        this.running = false;
        break;
      }

      for (const pair of config.pairs) {
        if (!this.running) break;
        try {
          // Only ever acts on opportunities the scanner already filtered to
          // net-positive (>= MIN_PROFIT_BPS after both legs). Nothing here
          // ever enters a trade expected to lose money.
          const opp = await findBestOpportunity(pair);
          if (!opp) continue;

          const result = await executeOpportunity(this.connection, wallet, opp);
          if (result.executed) {
            this.tradesExecuted += 1;
            this.cumulativeProfitLamports += opp.profitLamports;
            const sol = Number(opp.profitLamports) / 1e9;
            const total = Number(this.cumulativeProfitLamports) / 1e9;
            this.notify(
              `Trade #${this.tradesExecuted} ${opp.buyDex}->${opp.sellDex}: ` +
                `+${sol.toFixed(6)} SOL (${opp.profitBps}bps) | running total: ${total.toFixed(6)} SOL` +
                (result.bundleId ? ` | bundle=${result.bundleId}` : ""),
            );
          }
        } catch (err) {
          logger.error(`loop error for pair ${pair.mintA}/${pair.mintB}`, err);
        }
      }

      await sleep(config.pollIntervalMs);
    }

    this.notify("Engine stopped.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
