export interface ExchangeQuote {
  price: number;
  quoteVolume: number;
}

export interface ArbitrageOpportunity {
  base: string;
  buyExchange: string;
  buyPrice: number;
  sellExchange: string;
  sellPrice: number;
  spreadPct: number;
}
