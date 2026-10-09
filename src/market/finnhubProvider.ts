import { getSpec } from '../config/symbols';
import { roundToTick } from '../lib/orderMath';
import { generateHistory } from './simProvider';
import type { Candle, FailureListener, MarketDataProvider, Quote, Timeframe } from './types';

const WS_URL = 'wss://ws.finnhub.io?token=';
const REST_BASE = 'https://finnhub.io/api/v1';
/** Stock spread used to synthesize Bid/Ask from trade prints (Finnhub trades carry no quotes). */
const STOCK_SPREAD = 0.01;

type TradeMsg = { type: 'trade'; data: { s: string; p: number; v: number; t: number }[] };
type RestQuote = { c: number; pc: number; t: number };

/**
 * Finnhub free tier:
 * - WebSocket `trade` prints for US stocks (no Bid/Ask) — up to 50 symbols per connection.
 * - REST 60 calls/min; `/quote` is free, `/stock/candle` is premium — history is synthesized from `/quote`.
 * One shared socket is used for every subscribed symbol.
 */
export class FinnhubProvider implements MarketDataProvider {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<(q: Quote) => void>>();
  private restQuotes = new Map<string, Promise<RestQuote>>();
  private dead = false;

  private token: string;
  private onFailure: FailureListener;

  constructor(token: string, onFailure: FailureListener) {
    this.token = token;
    this.onFailure = onFailure;
  }

  private ensureSocket(): WebSocket {
    if (this.ws) return this.ws;
    const ws = new WebSocket(WS_URL + encodeURIComponent(this.token));
    ws.onopen = () => {
      for (const symbol of this.listeners.keys()) ws.send(JSON.stringify({ type: 'subscribe', symbol }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as TradeMsg | { type: string; msg?: string };
        if (msg.type === 'error') {
          this.failAll(`Finnhub error: ${(msg as { msg?: string }).msg ?? 'unknown'}`);
          return;
        }
        if (msg.type !== 'trade') return;
        // Coalesce prints per symbol: keep the latest price, sum the size.
        const latest = new Map<string, { p: number; v: number; t: number }>();
        for (const d of (msg as TradeMsg).data) {
          const prev = latest.get(d.s);
          latest.set(d.s, { p: d.p, t: d.t, v: (prev?.v ?? 0) + d.v });
        }
        for (const [symbol, d] of latest) {
          const tick = getSpec(symbol).tickSize;
          const bid = roundToTick(Math.floor((d.p - STOCK_SPREAD / 2) / tick + 1e-9) * tick, tick);
          const ask = roundToTick(bid + STOCK_SPREAD, tick);
          const q: Quote = { symbol, bid, ask, last: d.p, ts: d.t || Date.now(), size: d.v };
          this.listeners.get(symbol)?.forEach((l) => l(q));
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = () => this.failAll('WebSocket error');
    ws.onclose = () => this.failAll('WebSocket closed');
    this.ws = ws;
    return ws;
  }

  private failAll(reason: string) {
    if (this.dead) return;
    this.dead = true;
    const symbols = [...this.listeners.keys()];
    this.listeners.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    symbols.forEach((s) => this.onFailure(s, reason));
  }

  subscribe(symbol: string, onQuote: (q: Quote) => void): () => void {
    if (this.dead) {
      queueMicrotask(() => this.onFailure(symbol, 'Finnhub unavailable'));
      return () => {};
    }
    let set = this.listeners.get(symbol);
    const isNew = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(symbol, set);
    }
    set.add(onQuote);
    const ws = this.ensureSocket();
    if (isNew && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', symbol }));

    // Seed with the REST quote so the UI shows a price before the first trade print.
    this.restQuote(symbol)
      .then((rq) => {
        if (!set?.has(onQuote) || !(rq.c > 0)) return;
        const tick = getSpec(symbol).tickSize;
        const bid = roundToTick(rq.c - STOCK_SPREAD, tick);
        onQuote({ symbol, bid, ask: roundToTick(bid + STOCK_SPREAD, tick), last: rq.c, ts: Date.now() });
      })
      .catch(() => {});

    return () => {
      const s = this.listeners.get(symbol);
      s?.delete(onQuote);
      if (s && s.size === 0) {
        this.listeners.delete(symbol);
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'unsubscribe', symbol }));
      }
    };
  }

  private restQuote(symbol: string): Promise<RestQuote> {
    let p = this.restQuotes.get(symbol);
    if (!p) {
      p = fetch(`${REST_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(this.token)}`).then(async (r) => {
        if (!r.ok) throw new Error(`Finnhub quote ${r.status}`);
        return (await r.json()) as RestQuote;
      });
      p.catch(() => this.restQuotes.delete(symbol));
      this.restQuotes.set(symbol, p);
    }
    return p;
  }

  /** Previous session close from `/quote` (pc). */
  async getPrevClose(symbol: string): Promise<number | null> {
    const rq = await this.restQuote(symbol);
    return rq.pc > 0 ? rq.pc : null;
  }

  async getHistory(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    const rq = await this.restQuote(symbol);
    if (!(rq.c > 0)) throw new Error('Finnhub returned no price');
    return generateHistory(getSpec(symbol), rq.c, tf, limit, Date.now());
  }
}
