import "dotenv/config";
import type { TokenPair } from "./types.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function parsePairs(raw: string): TokenPair[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [mintA, mintB] = s.split(":");
      if (!mintA || !mintB) {
        throw new Error(`Malformed TOKEN_PAIRS entry: "${s}" (expected MINT_A:MINT_B)`);
      }
      return { mintA, mintB };
    });
}

export const config = {
  rpcUrl: process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
  privateKey: process.env.PRIVATE_KEY ?? "",
  pairs: parsePairs(process.env.TOKEN_PAIRS ?? ""),
  dexes: (process.env.DEXES ?? "Raydium,Orca,Meteora,Whirlpool")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  tradeSizeLamports: BigInt(process.env.TRADE_SIZE_LAMPORTS ?? "500000000"),
  minProfitBps: Number(process.env.MIN_PROFIT_BPS ?? "15"),
  slippageBps: Number(process.env.SLIPPAGE_BPS ?? "25"),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "1500"),
  // Hard cap on the priority fee Jupiter may attach per leg (lamports, not microLamports).
  // Keep this small relative to your trade size — it's a real, always-paid-if-landed cost.
  priorityFeeMaxLamports: Number(process.env.PRIORITY_FEE_MAX_LAMPORTS ?? "20000"),
  jitoEnabled: (process.env.JITO_ENABLED ?? "true") === "true",
  jitoBlockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL ?? "https://mainnet.block-engine.jito.wtf",
  jitoTipLamports: BigInt(process.env.JITO_TIP_LAMPORTS ?? "100000"),
  dryRun: (process.env.DRY_RUN ?? "true") === "true",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramOwnerId: process.env.TELEGRAM_OWNER_ID ?? "",
};

export function assertLiveTradingConfig(): void {
  required("PRIVATE_KEY");
  if (config.pairs.length === 0) {
    throw new Error("TOKEN_PAIRS is empty — nothing to scan");
  }
}
