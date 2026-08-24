# pump.fun Sniper Bot

Watches pump.fun for newly created tokens, buys immediately if the token's
market cap at launch is under `MAX_ENTRY_MARKET_CAP_SOL`, then auto-sells
each position at `+TAKE_PROFIT_PCT%` or `-STOP_LOSS_PCT%`. Single wallet,
public bonding-curve trades — no fake wallets, no wash trading, no
manipulation of other participants' trades. It's just a fast, automated bet
on very new, very illiquid tokens.

**Read this before funding it:** pump.fun tokens overwhelmingly go to zero —
most either get abandoned, rug-pulled, or simply never attract enough real
buyers to reach the take-profit threshold before the creator or early buyers
dump. A stop-loss limits the damage per snipe, it does not make the strategy
profitable on average. Treat every dollar you put into this as money you are
fully prepared to lose. This is speculation, not an income source.

## How it works

1. Connects to [PumpPortal](https://pumpportal.fun)'s public WebSocket feed and subscribes to new-token creation events.
2. On each new token, if its launch market cap (in SOL) is below `MAX_ENTRY_MARKET_CAP_SOL` and you have a free position slot, it buys `TRADE_SIZE_SOL` worth via PumpPortal's non-custodial trade-local API (they build the transaction, you sign and send it — your key never leaves your machine).
3. Subscribes to live trades on that mint. Since pump.fun's bonding-curve token supply is fixed pre-migration, market cap moves proportionally with price — the bot tracks `current_mcap / entry_mcap` as its P&L proxy.
4. When that ratio hits `+TAKE_PROFIT_PCT%` or `-STOP_LOSS_PCT%`, it sells the full position and reports realized SOL P&L (measured from your actual wallet balance delta, not the proxy ratio).

## Setup

```bash
npm install
cp .env.example .env
```

- `RPC_URL` — paid RPC (Helius/QuickNode); public RPC will not keep up.
- `TRADE_SIZE_SOL` — keep this small. This is the single most important risk control you have.
- Leave `DRY_RUN=true` until you've watched a session of (simulated) snipes and are comfortable with the pace and filter behavior.

## Running

Headless: `npm start` with `PRIVATE_KEY` set in `.env`.

Telegram-controlled: set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OWNER_ID`, then `npm start`.
In chat: `/connect <base58_private_key>` (delete the message after), `/run`, `/positions`, `/status`, `/stop`, `/dryrun off`.

## Known limitations

- Entry/exit P&L is tracked via market-cap ratio, which ignores bonding-curve slippage on your own buy/sell — realized results can differ modestly from the displayed ratio (the sell-side P&L notification uses your actual wallet balance delta, which is exact; the take-profit/stop-loss *trigger* itself uses the ratio approximation).
- No rug-pull heuristics (mint/freeze authority checks, holder concentration, socials) — it buys purely on "new + under market cap ceiling." Adding real filters here would meaningfully change the risk profile; ask if you want them.
- `MAX_CONCURRENT_POSITIONS` bounds exposure per moment, but a burst of simultaneous launches can still spend through your balance quickly — size `TRADE_SIZE_SOL` accordingly.
