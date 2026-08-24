import type { ExchangeQuote } from "../types.js";
import * as binance from "./binance.js";
import * as bybit from "./bybit.js";
import * as okx from "./okx.js";
import * as kucoin from "./kucoin.js";
import * as gateio from "./gateio.js";
import * as mexc from "./mexc.js";
import * as bitget from "./bitget.js";

export interface ExchangeAdapter {
  name: string;
  fetchTickers(quote: string): Promise<Map<string, ExchangeQuote>>;
}

export const ALL_EXCHANGES: ExchangeAdapter[] = [binance, bybit, okx, kucoin, gateio, mexc, bitget];
