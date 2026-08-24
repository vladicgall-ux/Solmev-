export interface NewTokenEvent {
  mint: string;
  name?: string;
  symbol?: string;
  marketCapSol: number;
  vSolInBondingCurve?: number;
  vTokensInBondingCurve?: number;
}

export interface TradeEvent {
  mint: string;
  marketCapSol: number;
}

export interface Position {
  mint: string;
  symbol: string;
  entryMarketCapSol: number;
  tokenAmount: number;
  costSol: number;
  openedAt: number;
}
