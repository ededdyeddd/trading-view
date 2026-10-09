export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D';

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
};

export type Quote = {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  ts: number;
  /** Optional traded size of the last print; used to grow the live bar volume. */
  size?: number;
};

export type Candle = {
  /** Bar open time, UNIX seconds (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export interface MarketDataProvider {
  subscribe(symbol: string, onQuote: (q: Quote) => void): () => void;
  getHistory(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]>;
}

/** Providers that can fail report it through this callback so the router can fall back to sim. */
export type FailureListener = (symbol: string, reason: string) => void;

export function barTime(tsMs: number, tf: Timeframe): number {
  const sec = Math.floor(tsMs / 1000);
  const step = TIMEFRAME_SECONDS[tf];
  return sec - (sec % step);
}
