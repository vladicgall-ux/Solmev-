import { config } from "./config.js";
import { logger } from "./logger.js";
import { SniperEngine } from "./engine.js";
import { isWalletConnected } from "./wallet.js";
async function main() {
    const engine = new SniperEngine();
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
    if (!isWalletConnected()) {
        throw new Error("No wallet: set PRIVATE_KEY in .env, or set TELEGRAM_BOT_TOKEN to control the bot from Telegram");
    }
    engine.start();
    process.once("SIGINT", () => engine.stop());
    process.once("SIGTERM", () => engine.stop());
}
main().catch((err) => {
    logger.error("fatal", err);
    process.exit(1);
});
