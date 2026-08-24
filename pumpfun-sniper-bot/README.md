# pump.fun Sniper Bot

Watches pump.fun for newly created tokens and buys them fresh (no market-cap
gate by default), then auto-sells each position at `+TAKE_PROFIT_PCT%` or
`-STOP_LOSS_PCT%`. Single wallet, public bonding-curve trades — no fake
wallets, no wash trading, no manipulation of other participants' trades.
It's just a fast, automated bet on very new, very illiquid tokens.

Controlled entirely through a button keyboard in Telegram — connect the
wallet, tune settings, start/stop, all by tapping, no commands to type
(except pasting the private key itself, which nothing can turn into a button).

**Read this before funding it:** pump.fun tokens overwhelmingly go to zero —
most either get abandoned, rug-pulled, or simply never attract enough real
buyers to reach the take-profit threshold before the creator or early buyers
dump. A stop-loss limits the damage per snipe, it does not make the strategy
profitable on average. Treat every dollar you put into this as money you are
fully prepared to lose. This is speculation, not an income source.

## How it works

1. Connects to [PumpPortal](https://pumpportal.fun)'s public WebSocket feed and subscribes to new-token creation events — this is the trigger, not polling, so there's no artificial delay between a launch and the bot seeing it.
2. On each new token (market-cap filter off by default — every fresh launch qualifies, unless you turn `🏦 Кап-фильтр` on), if you have a free position slot, it sizes the trade as `TRADE_SIZE_PCT`% of your **current** SOL balance and buys via PumpPortal's non-custodial trade-local API (they build the transaction, you sign and send it — your key never leaves your machine).
3. Subscribes to live trades on that mint. Since pump.fun's bonding-curve token supply is fixed pre-migration, market cap moves proportionally with price — the bot tracks `current_mcap / entry_mcap` as its P&L proxy.
4. When that ratio hits `+TAKE_PROFIT_PCT%` or `-STOP_LOSS_PCT%`, it sells the full position and reports realized SOL P&L (measured from your actual wallet balance delta, not the proxy ratio). The freed slot is immediately available to the next qualifying launch.

## Speed and fees

- **Fast mode** (`FAST_MODE`, on by default): skips the local transaction simulation and the RPC's own preflight check on the buy leg only — that's the side actually racing other snipers for the same launch. Sells always simulate first, since there's no race to win on exit, only fee money to lose on a botched one.
- **Dynamic priority fee** (`DYNAMIC_PRIORITY_FEE`, on by default): instead of a fixed fee, it reads the network's recent per-compute-unit fees and bids the 90th percentile on buys (aggressive — this is the leg that needs to win) and the median on sells (cheap — no race to win there). Always clamped between `MIN_PRIORITY_FEE_SOL` and `MAX_PRIORITY_FEE_SOL` so a fee spike can't blow the budget. This is what gives you both "fast" and "economical" instead of having to pick one static number and live with it.

## Setup

```bash
npm install
cp .env.example .env
```

- `RPC_URL` — paid RPC (Helius/QuickNode); public RPC will not keep up at snipe speed.
- `TRADE_SIZE_PCT` — % of current balance per snipe, recommended 5-10. This is the single most important risk control you have.
- Leave `DRY_RUN=true` until you've watched a session of (simulated) snipes and are comfortable with the pace and filter behavior.

## Running

Headless: `npm start` with `PRIVATE_KEY` set in `.env`.

Telegram-controlled (recommended): set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OWNER_ID` in `.env`, then `npm start`. Only that one Telegram user id can control the bot — every other chat is silently ignored.

In Telegram, everything is buttons on the keyboard at the bottom of the chat:

- **🔌 Кошелёк** — shows balance if connected, or prompts you to paste a base58 private key to connect. The bot tries to auto-delete that message right after (Telegram doesn't always allow bots to delete other users' messages — confirm it's gone).
- **▶️ Старт / ⏹ Стоп** — start scanning + auto-trading; stop taking new snipes (open positions are left running) and get a results summary (snipes taken, cumulative P&L, positions still open).
- **💰 Баланс**, **📊 Позиции** — current SOL balance; open positions.
- **⚙️ Настройки** — opens an inline panel to change take-profit %, stop-loss %, trade size % of balance, concurrent-position slots, the market-cap filter and its threshold, fast mode, dynamic fee, and dry-run — all live, no restart needed.

## Known limitations

- Entry/exit P&L is tracked via market-cap ratio, which ignores bonding-curve slippage on your own buy/sell — realized results can differ modestly from the displayed ratio (the sell-side P&L notification uses your actual wallet balance delta, which is exact; the take-profit/stop-loss *trigger* itself uses the ratio approximation).
- No rug-pull heuristics (mint/freeze authority checks, holder concentration, socials) — it buys purely on "new" (and, optionally, "under a market-cap ceiling"). Adding real filters here would meaningfully change the risk profile; ask if you want them.
- `MAX_CONCURRENT_POSITIONS` bounds exposure per moment, but a burst of simultaneous launches can still spend through a chunk of your balance quickly, since size is a % of current balance re-evaluated on every buy — that's by design (it self-scales down as the balance shrinks) but it means multiple fast losses compound faster than a fixed SOL amount would.
