# Cross-exchange arbitrage scanner

Watches spot prices for the same coin across several exchanges at once and
reports coins where the price differs enough between two of them to be worth
looking at — pushed to Telegram as they're found, or queryable on demand.

**This bot only scans and reports. It never places an order or moves funds
on your behalf** — turning a reported spread into a real profit still
requires you to actually buy on the cheap exchange and sell on the
expensive one (or already hold balances on both), and to account for
trading fees, withdrawal/network-transfer fees and time, and the fact that
the price can move before you act on either leg. Treat every number here as
"worth a manual look," not as a guaranteed, executable profit.

## How it works

1. On each scan cycle, calls each configured exchange's public "all
   tickers" REST endpoint (one HTTP request per exchange, no API key
   needed) and reads the last price + 24h quote volume for every pair
   quoted in `QUOTE_ASSET` (USDT by default).
2. Groups results by base coin (e.g. `BTC`) across exchanges, drops
   symbols that look like leveraged/derivative tokens (`BTCUP`, `ETH3L`,
   etc. — these can share a base-symbol name with the real spot coin on
   some exchanges without being the same asset), and for every coin seen
   on 2+ exchanges computes the % gap between the cheapest and priciest
   quote.
3. Keeps a gap only if **both** the cheap and expensive side clear
   `MIN_VOLUME_USD` in 24h volume on their own exchange (illiquid pairs
   produce spreads that look big but aren't really tradable at the quoted
   price) and the gap is between `MIN_SPREAD_PCT` and `MAX_SPREAD_PCT`
   (the upper bound filters out data artifacts — delisted pairs, wrapped-
   token mismatches — that show up as absurd 100%+ "spreads").
4. Surviving opportunities are sorted by spread size. New ones (not
   already alerted on the same coin + exchange pair within
   `ALERT_COOLDOWN_MIN`) are pushed to Telegram; the full current list is
   always available on demand.

## Setup

```bash
cd arbitrage-bot
npm install
cp .env.example .env
```

- `EXCHANGES` — which of the 7 supported exchanges (binance, bybit, okx,
  kucoin, gateio, mexc, bitget) to compare; drop any you don't care about.
- `MIN_VOLUME_USD` — the most important filter against false positives;
  raise it if you're still seeing spreads you wouldn't actually be able to
  fill at the quoted price.
- `POLL_INTERVAL_SEC` — 30s default is well inside every listed exchange's
  public rate limit even with all 7 enabled (one request per exchange per
  cycle).

## Running

```bash
npm run build && node dist/index.js
```

(`npm start` is intentionally just `dist/index.js` with no `node`/`npx` in
front — that's so hosting panels that build their own start command by
prepending `node` to `scripts.start` end up with a valid `node dist/index.js`.
It won't run directly in a plain shell; use the command above for that.)

**`dist/` is committed to the repo**, not gitignored. This is deliberate:
a panel that installs with `npm ci --only=production` skips
`devDependencies`, so `typescript` isn't available to compile anything at
deploy time. Shipping the compiled output means it never needs to build at
all, only install runtime deps and run the file. **If you change anything
under `src/`, run `npm run build` and commit the updated `dist/` in the
same commit** — otherwise the deployed bot keeps running the old code.

Headless (no Telegram): leave `TELEGRAM_BOT_TOKEN` unset — the bot scans on
`POLL_INTERVAL_SEC` and logs every opportunity to stdout.

Telegram-controlled (recommended): set `TELEGRAM_BOT_TOKEN` +
`TELEGRAM_OWNER_ID` in `.env`. Only that one Telegram user id can control
the bot — every other chat is silently ignored.

In Telegram, everything is buttons on the keyboard at the bottom of the chat:

- **▶️ Старт / ⏹ Стоп** — start/stop the scan loop. Alerts only fire while running.
- **📊 Топ сейчас** — the current top opportunities from the last completed scan, on demand (doesn't wait for the next cycle).
- **🏦 Биржи** — which exchanges and quote asset are active.
- **⚙️ Настройки** — inline panel to change min spread %, max spread % (sanity cap), min 24h volume, scan interval, and alert cooldown — all live, no restart needed.

## Known limitations

- Base-symbol matching is name-based (`BTCUSDT` → `BTC`), not asset-ID
  based — two exchanges occasionally reuse the same ticker for genuinely
  different tokens. The leveraged-token suffix filter and the
  `MAX_SPREAD_PCT` sanity cap catch the obvious cases, but a rare
  ticker-name collision can still produce a bogus "opportunity."
- Quoted prices are each exchange's last trade, not order-book depth — the
  real fillable price for any size beyond a small amount can be worse than
  what's shown, especially on the thinner side.
- No fee, withdrawal-time, or network-cost modeling: the displayed spread
  is gross, before trading fees on either leg and before whatever it costs
  (in time and fees) to actually move the coin between exchanges if you
  don't already hold balances on both sides.
