import { Telegraf } from "telegraf";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "./config.js";
import { setWalletFromPrivateKey, getWallet, isWalletConnected } from "./wallet.js";
import { TradingEngine } from "./engine.js";
import { logger } from "./logger.js";

function isOwner(ctx: { from?: { id: number } }): boolean {
  if (!config.telegramOwnerId) return false;
  return String(ctx.from?.id ?? "") === config.telegramOwnerId;
}

export function startTelegramBot(engine: TradingEngine): Telegraf {
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }
  if (!config.telegramOwnerId) {
    throw new Error("TELEGRAM_OWNER_ID is not set — required so only you can control the bot");
  }

  const bot = new Telegraf(config.telegramBotToken);
  const connection = new Connection(config.rpcUrl, "confirmed");

  bot.use(async (ctx, next) => {
    if (!isOwner(ctx)) {
      logger.warn(`Rejected command from unauthorized chat id=${ctx.from?.id}`);
      return; // silently ignore anyone who isn't the configured owner
    }
    return next();
  });

  engine.onTrade((msg) => {
    bot.telegram.sendMessage(config.telegramOwnerId, msg).catch((err) => logger.error("telegram notify failed", err));
  });

  bot.command("start", (ctx) =>
    ctx.reply(
      "Solana arb bot.\n" +
        "/connect <base58_private_key> — connect trading wallet (delete the message right after)\n" +
        "/balance — SOL balance\n" +
        "/run — start scanning & auto-trading (only executes trades already filtered net-profitable)\n" +
        "/stop — stop trading\n" +
        "/status — current state\n" +
        "/dryrun on|off — toggle simulate-only mode\n" +
        "/setminprofit <bps> — change minimum profit threshold",
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
      // Best-effort cleanup: the private key must not linger in chat history.
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
    await ctx.reply(`${wallet.publicKey.toBase58()}\n${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
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
      `Started. dry_run=${config.dryRun} min_profit_bps=${config.minProfitBps}\n` +
        (config.dryRun ? "Trades will only be simulated. Use /dryrun off to go live." : "LIVE — real trades will be sent."),
    );
  });

  bot.command("stop", async (ctx) => {
    engine.stop();
    await ctx.reply("Stopping after current scan cycle.");
  });

  bot.command("status", async (ctx) => {
    const wallet = getWallet();
    await ctx.reply(
      [
        `running: ${engine.isRunning()}`,
        `wallet: ${wallet ? wallet.publicKey.toBase58() : "not connected"}`,
        `dry_run: ${config.dryRun}`,
        `min_profit_bps: ${config.minProfitBps}`,
        `pairs: ${config.pairs.length}`,
        `dexes: ${config.dexes.join(",")}`,
        `trades executed: ${engine.tradesExecuted}`,
        `cumulative profit: ${(Number(engine.cumulativeProfitLamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
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

  bot.command("setminprofit", async (ctx) => {
    const arg = Number(ctx.message.text.split(" ")[1]);
    if (!Number.isFinite(arg) || arg < 0) {
      await ctx.reply("Usage: /setminprofit <bps, e.g. 15>");
      return;
    }
    config.minProfitBps = arg;
    await ctx.reply(`min_profit_bps set to ${arg}`);
  });

  bot.launch();
  logger.info("Telegram bot started");
  return bot;
}
