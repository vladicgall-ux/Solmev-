import type { JupiterQuoteResponse } from "./types.js";

const QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const SWAP_URL = "https://quote-api.jup.ag/v6/swap";

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
  dexes?: string[];
}

/**
 * Fetch a Jupiter quote, optionally restricted to a single DEX label so we
 * can compare per-venue pricing instead of always getting Jupiter's own
 * best-of-all-routes answer.
 */
export async function getQuote(params: QuoteParams): Promise<JupiterQuoteResponse | null> {
  const url = new URL(QUOTE_URL);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", params.slippageBps.toString());
  url.searchParams.set("onlyDirectRoutes", "false");
  if (params.dexes && params.dexes.length > 0) {
    url.searchParams.set("dexes", params.dexes.join(","));
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    if (res.status === 400 || res.status === 404) return null; // no route for this venue/pair
    throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as JupiterQuoteResponse;
}

export interface SwapTxParams {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  /** Hard cap on the priority fee Jupiter is allowed to attach to this tx, in lamports. */
  priorityFeeMaxLamports: number;
}

/** Ask Jupiter to build the serialized (base64) versioned swap transaction for a quote. */
export async function getSwapTransaction(params: SwapTxParams): Promise<string> {
  const res = await fetch(SWAP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: params.priorityFeeMaxLamports,
          global: false,
          priorityLevel: "high",
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Jupiter swap-tx build failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { swapTransaction: string };
  return body.swapTransaction;
}
