import { Telegraf } from "telegraf";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "./config.js";
import { setWalletFromPrivateKey, getWallet, isWalletConnected } from "./wallet.js";
import { SniperEngine } from "./engine.js";
import { logger } from "./logger.js";

function isOwner(ctx: { from?: { id: number } }): boolean {
  if (!config.telegramOwnerId) return false;
  return String(ctx.from?.id ?? "") === config.telegramOwnerId;
}

export function startTelegramBot(engine: SniperEngine): Telegraf {
  if (!config.telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!config.telegramOwnerId) throw new Error("TELEGRAM_OWNER_ID is not set");

  const bot = new Telegraf(config.telegramBotToken);
  const connection = new Connection(config.rpcUrl, "confirmed");

  bot.use(async (ctx, next) => {
    if (!isOwner(ctx)) {
      logger.warn(`Rejected command from unauthorized chat id=${ctx.from?.id}`);
      return;
    }
    return next();
  });

  engine.onTrade((msg) => {
    bot.telegram.sendMessage(config.telegramOwnerId, msg).catch((err) => logger.error("telegram notify failed", err));
  });

  bot.command("start", (ctx) =>
    ctx.reply(
      "pump.fun sniper bot.\n" +
        "/connect <base58_private_key> — connect wallet (delete the message after)\n" +
        "/balance — SOL balance\n" +
        "/run — start watching for new launches and auto-trading\n" +
        "/stop — stop taking new snipes (open positions stay open)\n" +
        "/positions — currently open positions\n" +
        "/status — settings + cumulative P&L\n" +
        "/dryrun on|off\n",
    ),
  );

  bot.command("connect", async (ctx) => {
    const arg = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!arg) {
      await ctx.reply("Usage: /connect <base58_private_key>");
      return;
    }
    try {
      const kp = setWalletFromPrivateKey(arg);
      await ctx.reply(`Wallet connected: ${kp.publicKey.toBase58()}`);
    } catch (err) {
      await ctx.reply(`Failed to load key: ${(err as Error).message}`);
      return;
    } finally {
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch {
        await ctx.reply("⚠️ Could not auto-delete your message — delete it manually now.");
      }
    }
  });

  bot.command("balance", async (ctx) => {
    const wallet = getWallet();
    if (!wallet) {
      await ctx.reply("No wallet connected. Use /connect first.");
      return;
    }
    const lamports = await connection.getBalance(wallet.publicKey);
    await ctx.reply(`${wallet.publicKey.toBase58()}\n${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  });

  bot.command("run", async (ctx) => {
    if (!isWalletConnected()) {
      await ctx.reply("No wallet connected. Use /connect <base58_private_key> first.");
      return;
    }
    if (engine.isRunning()) {
      await ctx.reply("Already running.");
      return;
    }
    engine.start();
    await ctx.reply(
      `Started. dry_run=${config.dryRun} size=${config.tradeSizeSol} SOL TP=+${config.takeProfitPct}% SL=-${config.stopLossPct}%\n` +
        (config.dryRun ? "Simulated only. /dryrun off to go live." : "LIVE — real snipes will be sent."),
    );
  });

  bot.command("stop", async (ctx) => {
    engine.stop();
    await ctx.reply("Stopped taking new snipes. Open positions are left as-is.");
  });

  bot.command("positions", async (ctx) => {
    const open = engine.openPositions();
    if (open.length === 0) {
      await ctx.reply("No open positions.");
      return;
    }
    await ctx.reply(
      open
        .map((p) => `${p.symbol} (${p.mint.slice(0, 6)}..) — cost ${p.costSol} SOL, entry mcap ${p.entryMarketCapSol.toFixed(1)} SOL`)
        .join("\n"),
    );
  });

  bot.command("status", async (ctx) => {
    const wallet = getWallet();
    await ctx.reply(
      [
        `running: ${engine.isRunning()}`,
        `wallet: ${wallet ? wallet.publicKey.toBase58() : "not connected"}`,
        `dry_run: ${config.dryRun}`,
        `trade_size: ${config.tradeSizeSol} SOL`,
        `max_entry_mcap: ${config.maxEntryMarketCapSol} SOL`,
        `TP/SL: +${config.takeProfitPct}% / -${config.stopLossPct}%`,
        `open positions: ${engine.openPositions().length}/${config.maxConcurrentPositions}`,
        `snipes taken: ${engine.snipesTaken}`,
        `cumulative P&L: ${engine.cumulativeProfitSol.toFixed(4)} SOL`,
      ].join("\n"),
    );
  });

  bot.command("dryrun", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1]?.toLowerCase();
    if (arg !== "on" && arg !== "off") {
      await ctx.reply("Usage: /dryrun on|off");
      return;
    }
    config.dryRun = arg === "on";
    await ctx.reply(`dry_run set to ${config.dryRun}`);
  });

  bot.launch();
  logger.info("Telegram bot started");
  return bot;
}
