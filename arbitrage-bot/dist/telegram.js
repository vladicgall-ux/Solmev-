import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config.js";
import { logger } from "./logger.js";
const BTN = {
    start: "▶️ Старт",
    stop: "⏹ Стоп",
    top: "📊 Топ сейчас",
    settings: "⚙️ Настройки",
    exchanges: "🏦 Биржи",
};
function isOwner(ctx) {
    if (!config.telegramOwnerId)
        return false;
    return String(ctx.from?.id ?? "") === config.telegramOwnerId;
}
function mainKeyboard() {
    return Markup.keyboard([
        [BTN.start, BTN.stop],
        [BTN.top, BTN.settings],
        [BTN.exchanges],
    ]).resize();
}
function settingsText() {
    return [
        "⚙️ Настройки сканера:",
        `📉 Мин. спред для показа/алерта: ${config.minSpreadPct}%`,
        `🧹 Макс. спред (фильтр аномалий): ${config.maxSpreadPct}%`,
        `💧 Мин. объём за 24ч на каждой бирже: $${config.minVolumeUsd.toLocaleString("en-US")}`,
        `⏱ Интервал сканирования: ${config.pollIntervalSec} сек`,
        `🔕 Кулдаун повторного алерта: ${config.alertCooldownMin} мин`,
    ].join("\n");
}
function settingsKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback("📉 Мин. спред", "set:minspread"), Markup.button.callback("💧 Мин. объём", "set:minvolume")],
        [Markup.button.callback("⏱ Интервал", "set:interval"), Markup.button.callback("🔕 Кулдаун", "set:cooldown")],
        [Markup.button.callback("✅ Закрыть", "close")],
    ]);
}
const FIELD_PROMPTS = {
    minspread: "Введи минимальный спред в % для показа и алертов (например 1):",
    minvolume: "Введи минимальный 24ч объём в USD, обязательный на каждой из двух бирж (например 50000):",
    interval: "Введи интервал сканирования в секундах (например 30):",
    cooldown: "Введи кулдаун повторного алерта по одной и той же связке монета+биржи, в минутах (например 15):",
};
function formatOpportunity(o) {
    return (`${o.base}  +${o.spreadPct.toFixed(2)}%\n` +
        `  купить на ${o.buyExchange}: ${o.buyPrice}\n` +
        `  продать на ${o.sellExchange}: ${o.sellPrice}`);
}
function formatList(opps, limit) {
    if (opps.length === 0)
        return "Пока ничего не найдено выше порога.";
    return opps.slice(0, limit).map(formatOpportunity).join("\n\n");
}
export function startTelegramBot(scanner) {
    if (!config.telegramBotToken)
        throw new Error("TELEGRAM_BOT_TOKEN is not set");
    if (!config.telegramOwnerId)
        throw new Error("TELEGRAM_OWNER_ID is not set");
    const bot = new Telegraf(config.telegramBotToken);
    const pending = new Map();
    bot.use(async (ctx, next) => {
        if (!isOwner(ctx)) {
            logger.warn(`Rejected update from unauthorized chat id=${ctx.from?.id}`);
            return;
        }
        return next();
    });
    scanner.onOpportunities((opps) => {
        const text = `🚨 Новые расхождения в цене (>=${config.minSpreadPct}%):\n\n${formatList(opps, 10)}`;
        bot.telegram.sendMessage(config.telegramOwnerId, text).catch((err) => logger.error("telegram notify failed", err));
    });
    bot.start((ctx) => ctx.reply("Межбиржевой арбитраж-сканер. Управляй кнопками внизу ⬇️\n\n" +
        `Сравнивает цены пар к ${config.quoteAsset} на биржах: ${config.exchanges.join(", ")}.\n` +
        "Нажми ▶️ Старт, чтобы начать сканирование.", mainKeyboard()));
    bot.hears(BTN.start, async (ctx) => {
        if (scanner.isRunning()) {
            await ctx.reply("Уже запущен.");
            return;
        }
        scanner.start();
        await ctx.reply(`Запущен. Интервал: ${config.pollIntervalSec}с, мин. спред: ${config.minSpreadPct}%, ` +
            `мин. объём: $${config.minVolumeUsd.toLocaleString("en-US")} на биржу.`);
    });
    bot.hears(BTN.stop, async (ctx) => {
        scanner.stop();
        await ctx.reply("Остановлен.");
    });
    bot.hears(BTN.top, async (ctx) => {
        const { results, scanAt, errors } = scanner.getLast();
        if (!scanAt) {
            await ctx.reply("Сканирование ещё не запускалось. Нажми ▶️ Старт.");
            return;
        }
        const header = `Последнее сканирование: ${scanAt.toLocaleTimeString("ru-RU")}` +
            (errors.length ? ` (⚠️ ошибки: ${errors.join("; ")})` : "");
        await ctx.reply(`${header}\n\n${formatList(results, config.topListSize)}`);
    });
    bot.hears(BTN.exchanges, async (ctx) => {
        await ctx.reply(`Активные биржи: ${config.exchanges.join(", ")}\nКвотируемая валюта: ${config.quoteAsset}`);
    });
    bot.hears(BTN.settings, async (ctx) => {
        await ctx.reply(settingsText(), settingsKeyboard());
    });
    bot.on("callback_query", async (ctx) => {
        const data = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
        if (!data)
            return;
        if (data === "close") {
            await ctx.answerCbQuery();
            await ctx.deleteMessage().catch(() => { });
            return;
        }
        if (data.startsWith("set:")) {
            const field = data.slice("set:".length);
            pending.set(ctx.chat.id, field);
            await ctx.answerCbQuery();
            await ctx.reply(FIELD_PROMPTS[field]);
            return;
        }
    });
    bot.on(message("text"), async (ctx) => {
        const chatId = ctx.chat.id;
        const field = pending.get(chatId);
        if (!field)
            return; // not awaiting input and not a known button — ignore free text
        const text = ctx.message.text.trim();
        const value = Number(text.replace(",", "."));
        if (!Number.isFinite(value) || value < 0) {
            await ctx.reply("Нужно число, попробуй ещё раз.");
            return;
        }
        switch (field) {
            case "minspread":
                config.minSpreadPct = value;
                break;
            case "minvolume":
                config.minVolumeUsd = value;
                break;
            case "interval":
                config.pollIntervalSec = Math.max(5, Math.round(value));
                if (scanner.isRunning()) {
                    scanner.stop();
                    scanner.start();
                }
                break;
            case "cooldown":
                config.alertCooldownMin = value;
                break;
        }
        pending.delete(chatId);
        await ctx.reply("Сохранено ✅");
        await ctx.reply(settingsText(), settingsKeyboard());
    });
    bot.launch();
    logger.info("Telegram bot started (button UI)");
    return bot;
}
