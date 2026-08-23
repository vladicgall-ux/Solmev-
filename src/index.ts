import { config } from "./config.js";
import { logger } from "./logger.js";
import { TradingEngine } from "./engine.js";
import { isWalletConnected } from "./wallet.js";

async function main() {
  const engine = new TradingEngine();

  if (config.telegramBotToken) {
    const { startTelegramBot } = await import("./telegram.js");
    const bot = startTelegramBot(engine);
    logger.info("Telegram-controlled mode. Use /connect then /run in your Telegram chat.");

    process.once("SIGINT", () => {
      engine.stop();
      bot.stop("SIGINT");
    });
    process.once("SIGTERM", () => {
      engine.stop();
      bot.stop("SIGTERM");
    });
    return;
  }

  // Headless CLI mode: wallet must come from PRIVATE_KEY in .env.
  if (config.pairs.length === 0) {
    throw new Error("TOKEN_PAIRS is empty — nothing to scan");
  }
  if (!isWalletConnected()) {
    throw new Error("No wallet: set PRIVATE_KEY in .env, or set TELEGRAM_BOT_TOKEN to control the bot from Telegram");
  }

  engine.onTrade(() => {}); // already logged by the engine itself
  engine.start();

  process.once("SIGINT", () => engine.stop());
  process.once("SIGTERM", () => engine.stop());
}

main().catch((err) => {
  logger.error("fatal", err);
  process.exit(1);
});
