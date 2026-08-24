# Solana Arbitrage Bot

Cross-DEX arbitrage bot. It scans the same token pair across multiple DEXs
(via Jupiter's per-venue quote routing), and when buying on one venue and
selling on another nets more than `MIN_PROFIT_BPS` after both legs, it
executes — buy and sell landed atomically in a single Jito bundle so a
failed second leg can never leave you holding an unwanted position.

It does **not** do directional/speculative trading and does not touch other
users' transactions (no front-running, no mempool sniping) — it only ever
acts on a price gap between two AMMs that already exists independent of
anyone else's pending trade. Every trade the engine sends has already
passed the profit-threshold filter in `src/scanner.ts`; it never submits a
leg it expects to lose money on (fees/slippage can still make a landed
trade net negative — see Risks below).

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `RPC_URL` — use a paid RPC (Helius/Triton/QuickNode). Public RPC will rate-limit you into uselessness.
- `PRIVATE_KEY` — base58 secret key, only needed for headless CLI mode (see below).
- Leave `DRY_RUN=true` until you've watched it log opportunities for a while and trust the numbers.

## Running

### Headless (CLI, wallet from `.env`)

```bash
npm run build && node dist/index.js
```

(`npm start` is intentionally just `dist/index.js` with no `node`/`npx` in
front of it — that's so hosting panels that build their own start command
by prepending `node` to whatever `scripts.start` says end up with a valid
`node dist/index.js`. It means `npm start` won't run directly in a plain
shell; use the command above for that.)

Starts scanning immediately using `PRIVATE_KEY` from `.env`.

### Telegram-controlled

Set `TELEGRAM_BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)) and
`TELEGRAM_OWNER_ID` (your numeric id from [@userinfobot](https://t.me/userinfobot))
in `.env`, then `npm run build && node dist/index.js`. The bot ignores every chat except your own id.

In your Telegram chat with the bot:

```
/connect <base58_private_key>   # loads the wallet, then delete that message
/balance                        # confirm it landed
/run                            # start scanning + auto-trading
/status                         # running state, wallet, cumulative profit
/dryrun off                     # go live once you trust dry-run output
/setminprofit 20                # raise/lower the bps threshold live
/stop
```

You'll get a Telegram message for every trade the engine actually sends,
with the profit and a running total.

## How the arb is found

For each configured pair (`TOKEN_PAIRS` in `.env`, `MINT_A:MINT_B`):
1. Fetch a Jupiter quote for `A -> B` restricted to each DEX in `DEXES` individually (`dexes=Raydium`, `dexes=Orca`, …) — this bypasses Jupiter's own cross-DEX routing so you see each venue's raw price.
2. For every such buy quote, fetch `B -> A` quotes on every other DEX.
3. Compute the round-trip: `final_A - initial_A`. If the best combination clears `MIN_PROFIT_BPS`, it's a candidate.
4. Build both swap transactions via Jupiter's `/swap` endpoint, simulate both, and if simulation passes, submit `[buyTx, sellTx, tipTx]` as one Jito bundle — it either all lands or none of it does.

## Risks (read before setting `DRY_RUN=false`)

- **Execution risk**: by the time your bundle lands, the price gap may have closed (someone else took it, or the pool moved). The profit check happens against a quote, not a guarantee — this is normal for all on-chain arb, not a bug.
- **Bundle non-inclusion**: Jito bundles aren't guaranteed to land; if the bundle is dropped, nothing executes and nothing is lost beyond the tip attempt.
- **RPC/API rate limits**: the scan does `O(dexes²)` Jupiter quote calls per pair per poll — tune `POLL_INTERVAL_MS` and `DEXES` down if you're getting 429s.
- **Wallet custody**: `/connect` sends your private key as a Telegram message. Telegram transport is encrypted, but use a **dedicated hot wallet with only the capital you're willing to risk** — never your main wallet — and always delete the message after connecting (the bot tries to auto-delete it, but confirm manually).
- **Competition**: this is a well-known strategy; expect most easy gaps to already be taken by faster/co-located bots. This is a working starting point, not a guaranteed-profitable black box — tune thresholds and pairs to your own findings.
