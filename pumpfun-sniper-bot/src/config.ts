import "dotenv/config";

export const config = {
  rpcUrl: process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
  privateKey: process.env.PRIVATE_KEY ?? "",
  tradeSizeSol: Number(process.env.TRADE_SIZE_SOL ?? "0.02"),
  maxEntryMarketCapSol: Number(process.env.MAX_ENTRY_MARKET_CAP_SOL ?? "50"),
  takeProfitPct: Number(process.env.TAKE_PROFIT_PCT ?? "100"),
  stopLossPct: Number(process.env.STOP_LOSS_PCT ?? "10"),
  maxConcurrentPositions: Number(process.env.MAX_CONCURRENT_POSITIONS ?? "3"),
  slippagePct: Number(process.env.SLIPPAGE_PCT ?? "15"),
  priorityFeeSol: Number(process.env.PRIORITY_FEE_SOL ?? "0.0005"),
  dryRun: (process.env.DRY_RUN ?? "true") === "true",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramOwnerId: process.env.TELEGRAM_OWNER_ID ?? "",
};
