import { config } from "./config.js";
import { getQuote } from "./jupiter.js";
import { logger } from "./logger.js";
import type { JupiterQuoteResponse, Opportunity, TokenPair } from "./types.js";

interface DexQuoteResult {
  dex: string;
  quote: JupiterQuoteResponse;
}

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111";
const BASE_FEE_LAMPORTS_PER_TX = 5_000n; // buy leg + sell leg + Jito tip tx

/**
 * Jito tip + priority fees + base fees are paid in SOL regardless of which
 * token the round trip is denominated in. When the pair's base asset is
 * wrapped SOL, this is directly comparable to profitLamports and we enforce
 * it as a floor; for other pairs we can't convert without a price feed, so
 * we fall back to the bps-only check (see findBestOpportunity).
 */
function fixedCostLamports(): bigint {
  return config.jitoTipLamports + 2n * BigInt(config.priorityFeeMaxLamports) + 3n * BASE_FEE_LAMPORTS_PER_TX;
}

async function quotesPerDex(
  inputMint: string,
  outputMint: string,
  amount: bigint,
): Promise<DexQuoteResult[]> {
  const results = await Promise.all(
    config.dexes.map(async (dex) => {
      try {
        const quote = await getQuote({
          inputMint,
          outputMint,
          amount,
          slippageBps: config.slippageBps,
          dexes: [dex],
        });
        return quote ? { dex, quote } : null;
      } catch (err) {
        logger.warn(`quote fetch failed on ${dex} for ${inputMint}->${outputMint}`, err);
        return null;
      }
    }),
  );
  return results.filter((r): r is DexQuoteResult => r !== null);
}

/**
 * Scans one token pair for a profitable buy-on-X / sell-on-Y round trip.
 * Buys mintB with mintA on each DEX, then for each of those legs tries
 * selling mintB back to mintA on every DEX, keeping the most profitable
 * (buyDex, sellDex) combination found.
 */
export async function findBestOpportunity(pair: TokenPair): Promise<Opportunity | null> {
  const buyQuotes = await quotesPerDex(pair.mintA, pair.mintB, config.tradeSizeLamports);
  if (buyQuotes.length === 0) return null;

  let best: Opportunity | null = null;

  await Promise.all(
    buyQuotes.map(async ({ dex: buyDex, quote: buyQuote }) => {
      const bOut = BigInt(buyQuote.outAmount);
      const sellQuotes = await quotesPerDex(pair.mintB, pair.mintA, bOut);
      for (const { dex: sellDex, quote: sellQuote } of sellQuotes) {
        if (sellDex === buyDex) continue; // no arb buying/selling on the same venue
        const finalOut = BigInt(sellQuote.outAmount);
        const profitLamports = finalOut - config.tradeSizeLamports;
        const profitBps = Number((profitLamports * 10_000n) / config.tradeSizeLamports);

        const clearsFixedCosts =
          pair.mintA !== WRAPPED_SOL_MINT || profitLamports > fixedCostLamports();
        if (!clearsFixedCosts) continue;

        if (profitBps >= config.minProfitBps) {
          if (!best || profitLamports > best.profitLamports) {
            best = {
              pair,
              buyDex,
              sellDex,
              buyQuote,
              sellQuote,
              inAmount: config.tradeSizeLamports,
              outAmount: finalOut,
              profitLamports,
              profitBps,
            };
          }
        }
      }
    }),
  );

  return best;
}
