import { config } from "./config.js";
import { logger } from "./logger.js";
import { ArbitrageScanner } from "./scanner.js";

async function main() {
  const scanner = new ArbitrageScanner();

  if (config.telegramBotToken) {
    const { startTelegramBot } = await import("./telegram.js");
    const bot = startTelegramBot(scanner);
    logger.info(`Telegram-controlled mode. Exchanges: ${config.exchanges.join(", ")}`);

    process.once("SIGINT", () => {
      scanner.stop();
      bot.stop("SIGINT");
    });
    process.once("SIGTERM", () => {
      scanner.stop();
      bot.stop("SIGTERM");
    });
    return;
  }

  logger.info(`Headless mode (no TELEGRAM_BOT_TOKEN set). Exchanges: ${config.exchanges.join(", ")}`);
  scanner.onOpportunities((opps) => {
    for (const o of opps) {
      logger.info(`${o.base}: +${o.spreadPct.toFixed(2)}% buy@${o.buyExchange}=${o.buyPrice} sell@${o.sellExchange}=${o.sellPrice}`);
    }
  });
  scanner.start();
  process.once("SIGINT", () => scanner.stop());
  process.once("SIGTERM", () => scanner.stop());
}

main().catch((err) => {
  logger.error("fatal", err);
  process.exit(1);
});
