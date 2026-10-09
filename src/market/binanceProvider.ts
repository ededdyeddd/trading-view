import type { Candle, FailureListener, MarketDataProvider, Quote, Timeframe } from './types';

const WS_BASE = 'wss://stream.binance.com:9443/stream?streams=';
const REST_BASE = 'https://api.binance.com/api/v3';
/** bookTicker fires many times per second; quotes are coalesced to this interval. */
const EMIT_INTERVAL_MS = 250;

const INTERVALS: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1D': '1d',
};

type BookTicker = { s: string; b: string; a: string };
type AggTrade = { s: string; p: string; q: string; T: number };

/** Public Binance spot streams: Bid/Ask from `bookTicker`, last/size from `aggTrade`, candles from `klines`. No key needed. */
export class BinanceProvider implements MarketDataProvider {
  private onFailure: FailureListener;

  constructor(onFailure: FailureListener) {
    this.onFailure = onFailure;
  }

  subscribe(symbol: string, onQuote: (q: Quote) => void): () => void {
    const s = symbol.toLowerCase();
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let bid = 0;
    let ask = 0;
    let last = 0;
    let size = 0;
    let dirty = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fail = (reason: string) => {
      if (closedByUs) return;
      closedByUs = true;
      cleanup();
      this.onFailure(symbol, reason);
    };

    const cleanup = () => {
      if (timer) clearInterval(timer);
      timer = null;
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      }
      ws = null;
    };

    try {
      ws = new WebSocket(`${WS_BASE}${s}@bookTicker/${s}@aggTrade`);
    } catch (e) {
      queueMicrotask(() => fail(`WebSocket error: ${String(e)}`));
      return () => {
        closedByUs = true;
      };
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { stream: string; data: BookTicker | AggTrade };
        if (msg.stream.endsWith('@bookTicker')) {
          const d = msg.data as BookTicker;
          bid = Number(d.b);
          ask = Number(d.a);
          if (!last) last = (bid + ask) / 2;
        } else {
          const d = msg.data as AggTrade;
          last = Number(d.p);
          size += Number(d.q);
        }
        dirty = true;
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = () => fail('WebSocket error');
    ws.onclose = () => fail('WebSocket closed');

    timer = setInterval(() => {
      if (!dirty || !bid || !ask) return;
      dirty = false;
      onQuote({ symbol, bid, ask, last, ts: Date.now(), size: size || undefined });
      size = 0;
    }, EMIT_INTERVAL_MS);

    return () => {
      closedByUs = true;
      cleanup();
    };
  }

  async getHistory(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    const url = `${REST_BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${INTERVALS[tf]}&limit=${Math.min(limit, 1000)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
    const rows = (await res.json()) as [number, string, string, string, string, string][];
    return rows.map((r) => ({
      time: Math.floor(r[0] / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  }
}
