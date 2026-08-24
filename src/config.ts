import "dotenv/config";

export const config = {
  rpcUrl: process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
  privateKey: process.env.PRIVATE_KEY ?? "",
  // Trade size is computed fresh before every buy as this % of the
  // wallet's current SOL balance, not a fixed amount — so it scales down
  // automatically as the balance shrinks (or grows) instead of over- or
  // under-committing. Recommended range 5-10.
  tradeSizePctOfBalance: Number(process.env.TRADE_SIZE_PCT ?? "7"),
  // Always left unspent as a fee/rent buffer when sizing a trade off balance.
  minSolReserve: Number(process.env.MIN_SOL_RESERVE ?? "0.01"),
  // Off by default: buy any fresh launch regardless of market cap. Turn on
  // (via /settings or MCAP_FILTER_ENABLED=true) to only snipe tokens whose
  // launch market cap is under maxEntryMarketCapSol.
  mcapFilterEnabled: (process.env.MCAP_FILTER_ENABLED ?? "false") === "true",
  maxEntryMarketCapSol: Number(process.env.MAX_ENTRY_MARKET_CAP_SOL ?? "50"),
  takeProfitPct: Number(process.env.TAKE_PROFIT_PCT ?? "100"),
  stopLossPct: Number(process.env.STOP_LOSS_PCT ?? "10"),
  maxConcurrentPositions: Number(process.env.MAX_CONCURRENT_POSITIONS ?? "3"),
  slippagePct: Number(process.env.SLIPPAGE_PCT ?? "15"),

  // Manual priority fee, used as-is when dynamicPriorityFee is off, and as
  // the fallback when the RPC can't be queried for recent fees.
  priorityFeeSol: Number(process.env.PRIORITY_FEE_SOL ?? "0.0005"),
  // When on, the priority fee is estimated per-trade from recent network
  // fees instead of a fixed value: aggressive (high percentile) on buys,
  // since that's the only side actually racing other bots; cheap (median)
  // on sells, since exiting isn't a race. Bounded by min/max below either way.
  dynamicPriorityFee: (process.env.DYNAMIC_PRIORITY_FEE ?? "true") === "true",
  minPriorityFeeSol: Number(process.env.MIN_PRIORITY_FEE_SOL ?? "0.00001"),
  maxPriorityFeeSol: Number(process.env.MAX_PRIORITY_FEE_SOL ?? "0.002"),

  // Fast mode skips the pre-send simulateTransaction round trip and tells
  // the RPC to skip its own preflight check on buys, trading a safety net
  // (catching a doomed tx before paying its base fee) for one fewer network
  // round trip on the time-critical leg. Sells always simulate — you choose
  // when to exit, so there's no race to win there, only a chance to lose
  // fee money after a botched sell.
  fastMode: (process.env.FAST_MODE ?? "true") === "true",

  dryRun: (process.env.DRY_RUN ?? "true") === "true",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramOwnerId: process.env.TELEGRAM_OWNER_ID ?? "",
};
