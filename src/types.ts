export interface TokenPair {
  mintA: string;
  mintB: string;
}

export interface DexQuote {
  dex: string;
  inAmount: bigint;
  outAmount: bigint;
  raw: JupiterQuoteResponse;
}

export interface JupiterRoutePlanStep {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlanStep[];
}

export interface Opportunity {
  pair: TokenPair;
  buyDex: string;
  sellDex: string;
  buyQuote: JupiterQuoteResponse;
  sellQuote: JupiterQuoteResponse;
  inAmount: bigint;
  outAmount: bigint;
  profitLamports: bigint;
  profitBps: number;
}
