import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "./config.js";
import { setWalletFromPrivateKey, getWallet, isWalletConnected } from "./wallet.js";
import { logger } from "./logger.js";
const BTN = {
    start: "▶️ Старт",
    stop: "⏹ Стоп",
    balance: "💰 Баланс",
    positions: "📊 Позиции",
    settings: "⚙️ Настройки",
    wallet: "🔌 Кошелёк",
};
function isOwner(ctx) {
    if (!config.telegramOwnerId)
        return false;
    return String(ctx.from?.id ?? "") === config.telegramOwnerId;
}
function mainKeyboard() {
    return Markup.keyboard([
        [BTN.start, BTN.stop],
        [BTN.balance, BTN.positions],
        [BTN.settings, BTN.wallet],
    ]).resize();
}
function settingsText() {
    const mcap = config.mcapFilterEnabled ? `ON (<=${config.maxEntryMarketCapSol} SOL)` : "OFF (любая свежая монета)";
    return [
        "⚙️ Настройки бота:",
        `🎯 Take-profit: +${config.takeProfitPct}%`,
        `🛑 Stop-loss: -${config.stopLossPct}%`,
        `💵 Размер сделки: ${config.tradeSizePctOfBalance}% от баланса`,
        `🔢 Слотов одновременно: ${config.maxConcurrentPositions}`,
        `🏦 Фильтр по капе: ${mcap}`,
        `🐇 Fast mode: ${config.fastMode ? "ON" : "OFF"}`,
        `⚡ Динамическая комиссия: ${config.dynamicPriorityFee ? "ON" : "OFF"}`,
        `🧪 Dry run: ${config.dryRun ? "ON (без реальных сделок)" : "OFF (боевой режим)"}`,
    ].join("\n");
}
function settingsKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback("🎯 TP", "set:tp"), Markup.button.callback("🛑 SL", "set:sl")],
        [Markup.button.callback("💵 Размер", "set:size"), Markup.button.callback("🔢 Слоты", "set:slots")],
        [
            Markup.button.callback(`🏦 Кап-фильтр: ${config.mcapFilterEnabled ? "ON" : "OFF"}`, "toggle:mcap"),
            Markup.button.callback("📈 Порог капы", "set:maxmcap"),
        ],
        [
            Markup.button.callback(`🐇 Fast: ${config.fastMode ? "ON" : "OFF"}`, "toggle:fast"),
            Markup.button.callback(`⚡ Dyn.fee: ${config.dynamicPriorityFee ? "ON" : "OFF"}`, "toggle:dynfee"),
        ],
        [Markup.button.callback(`🧪 Dry run: ${config.dryRun ? "ON" : "OFF"}`, "toggle:dryrun")],
        [Markup.button.callback("✅ Закрыть", "close")],
    ]);
}
const FIELD_PROMPTS = {
    tp: "Введи новый take-profit в % (например 100):",
    sl: "Введи новый stop-loss в % (например 10):",
    size: "Введи размер сделки в % от баланса, рекомендуется 5-10 (например 7):",
    slots: "Введи макс. число одновременных позиций (например 3):",
    maxmcap: "Введи порог market cap на входе, в SOL (например 50):",
};
export function startTelegramBot(engine) {
    if (!config.telegramBotToken)
        throw new Error("TELEGRAM_BOT_TOKEN is not set");
    if (!config.telegramOwnerId)
        throw new Error("TELEGRAM_OWNER_ID is not set");
    const bot = new Telegraf(config.telegramBotToken);
    const connection = new Connection(config.rpcUrl, "confirmed");
    const pending = new Map();
    bot.use(async (ctx, next) => {
        if (!isOwner(ctx)) {
            logger.warn(`Rejected update from unauthorized chat id=${ctx.from?.id}`);
            return;
        }
        return next();
    });
    engine.onTrade((msg) => {
        bot.telegram.sendMessage(config.telegramOwnerId, msg).catch((err) => logger.error("telegram notify failed", err));
    });
    bot.start((ctx) => ctx.reply("pump.fun sniper bot. Управляй кнопками внизу ⬇️\n\n" +
        "Сначала подключи кошелёк (🔌 Кошелёк), затем ▶️ Старт.", mainKeyboard()));
    bot.hears(BTN.wallet, async (ctx) => {
        const wallet = getWallet();
        if (wallet) {
            const lamports = await connection.getBalance(wallet.publicKey);
            await ctx.reply(`Подключён: ${wallet.publicKey.toBase58()}\n${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL\n\n` +
                "Чтобы сменить кошелёк — пришли новый приватный ключ (base58) следующим сообщением.");
        }
        else {
            await ctx.reply("Кошелёк не подключен. Пришли приватный ключ (base58) следующим сообщением.");
        }
        pending.set(ctx.chat.id, "connect");
    });
    bot.hears(BTN.balance, async (ctx) => {
        const wallet = getWallet();
        if (!wallet) {
            await ctx.reply("Кошелёк не подключен. Нажми 🔌 Кошелёк.");
            return;
        }
        const lamports = await connection.getBalance(wallet.publicKey);
        await ctx.reply(`${wallet.publicKey.toBase58()}\n${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    });
    bot.hears(BTN.start, async (ctx) => {
        if (!isWalletConnected()) {
            await ctx.reply("Сначала подключи кошелёк — 🔌 Кошелёк.");
            return;
        }
        if (engine.isRunning()) {
            await ctx.reply("Уже запущен.");
            return;
        }
        engine.start();
        await ctx.reply(`Запущен. dry_run=${config.dryRun} size=${config.tradeSizePctOfBalance}% of balance TP=+${config.takeProfitPct}% SL=-${config.stopLossPct}%\n` +
            (config.dryRun ? "Режим симуляции. В ⚙️ Настройки выключи Dry run для боевого режима." : "БОЕВОЙ РЕЖИМ — реальные сделки."));
    });
    bot.hears(BTN.stop, async (ctx) => {
        const summary = engine.stop();
        await ctx.reply(summary);
    });
    bot.hears(BTN.positions, async (ctx) => {
        const open = engine.openPositions();
        if (open.length === 0) {
            await ctx.reply("Открытых позиций нет.");
            return;
        }
        await ctx.reply(open
            .map((p) => `${p.symbol} (${p.mint.slice(0, 6)}..) — ${p.costSol} SOL, вход при капе ${p.entryMarketCapSol.toFixed(1)} SOL`)
            .join("\n"));
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
        if (data.startsWith("toggle:")) {
            const key = data.slice("toggle:".length);
            if (key === "mcap")
                config.mcapFilterEnabled = !config.mcapFilterEnabled;
            else if (key === "fast")
                config.fastMode = !config.fastMode;
            else if (key === "dynfee")
                config.dynamicPriorityFee = !config.dynamicPriorityFee;
            else if (key === "dryrun")
                config.dryRun = !config.dryRun;
            await ctx.answerCbQuery("Обновлено");
            await ctx.editMessageText(settingsText(), settingsKeyboard()).catch(() => { });
            return;
        }
        if (data.startsWith("set:")) {
            const field = data.slice("set:".length);
            pending.set(ctx.chat.id, field);
            await ctx.answerCbQuery();
            await ctx.reply(FIELD_PROMPTS[field]);
        }
    });
    bot.on(message("text"), async (ctx) => {
        const chatId = ctx.chat.id;
        const field = pending.get(chatId);
        if (!field)
            return; // not awaiting input and not a known button — ignore free text
        const text = ctx.message.text.trim();
        if (field === "connect") {
            pending.delete(chatId);
            try {
                const kp = setWalletFromPrivateKey(text);
                await ctx.reply(`Кошелёк подключен: ${kp.publicKey.toBase58()}`);
            }
            catch (err) {
                await ctx.reply(`Не удалось загрузить ключ: ${err.message}`);
            }
            finally {
                try {
                    await ctx.deleteMessage(ctx.message.message_id);
                }
                catch {
                    await ctx.reply("⚠️ Не смог удалить твоё сообщение — удали вручную, там приватный ключ.");
                }
            }
            return;
        }
        const value = Number(text.replace(",", "."));
        if (!Number.isFinite(value) || value < 0) {
            await ctx.reply("Нужно число, попробуй ещё раз.");
            return;
        }
        switch (field) {
            case "tp":
                config.takeProfitPct = value;
                break;
            case "sl":
                config.stopLossPct = value;
                break;
            case "size":
                config.tradeSizePctOfBalance = value;
                break;
            case "slots":
                config.maxConcurrentPositions = Math.max(1, Math.round(value));
                break;
            case "maxmcap":
                config.maxEntryMarketCapSol = value;
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
