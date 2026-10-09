import { getSpec, type SymbolSpec } from '../config/symbols';
import { roundToTick } from '../lib/orderMath';
import { TIMEFRAME_SECONDS, barTime, type Candle, type MarketDataProvider, type Quote, type Timeframe } from './types';

/** Seconds of trading per day used to convert daily volatility into per-tick volatility. */
const SECONDS_PER_DAY = 6.5 * 3600;
/** Ticks are boosted so price moves visibly during a short usability session. */
const ACTIVITY_BOOST = 3;

type SimState = {
  spec: SymbolSpec;
  mid: number;
  listeners: Set<(q: Quote) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  lastQuote: Quote;
  history: Map<Timeframe, Candle[]>;
};

/** Box–Muller standard normal. */
function gauss(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Small deterministic PRNG so generated history is stable per symbol within a session. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * How the simulator moves prices. 'gauss': realistic volatility, ticks every 300–800 ms (default).
 * Price-field test modes with a constant spread: 'calm' = −2..+2 ticks every 500 ms, 'volatile' = −20..+20 ticks every 200 ms.
 */
export type SimWalk = 'gauss' | 'calm' | 'volatile';
const TICK_WALKS: Record<Exclude<SimWalk, 'gauss'>, { ms: number; ticks: number }> = {
  calm: { ms: 500, ticks: 2 },
  volatile: { ms: 200, ticks: 20 },
};

export type SimOptions = {
  /** Override starting prices, e.g. anchor to the last real price after a live feed drops. */
  anchors?: Record<string, number>;
  random?: () => number;
  now?: () => number;
  /** Keep every symbol at its seed quote (screenshot comparisons). */
  frozen?: boolean;
  walk?: SimWalk;
};

/**
 * Random-walk simulator. One timer per subscribed symbol, ticking every 300–800 ms.
 * Quotes keep the symbol's spread; history is generated backwards so the last bar ends at the current price.
 */
export class SimProvider implements MarketDataProvider {
  private states = new Map<string, SimState>();
  private rand: () => number;
  private now: () => number;
  private anchors: Record<string, number>;
  private frozen: boolean;
  walk: SimWalk;

  constructor(opts: SimOptions = {}) {
    this.frozen = !!opts.frozen;
    this.walk = opts.walk ?? 'gauss';
    this.rand = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.anchors = { ...opts.anchors };
  }

  /** Re-seed a symbol at a given price (used when a live feed falls back to sim). */
  anchor(symbol: string, price: number): void {
    this.anchors[symbol] = price;
    const st = this.states.get(symbol);
    if (st) {
      st.mid = price;
      st.lastQuote = this.makeQuote(st);
    }
  }

  private state(symbol: string): SimState {
    let st = this.states.get(symbol);
    if (!st) {
      const spec = getSpec(symbol);
      const spread = spec.sim.spreadTicks * spec.tickSize;
      const anchor = this.anchors[symbol];
      const mid = anchor ?? spec.sim.bid + spread / 2;
      st = { spec, mid, listeners: new Set(), timer: null, lastQuote: null as unknown as Quote, history: new Map() };
      st.lastQuote = this.makeQuote(st, anchor === undefined ? spec.sim.bid : undefined);
      this.states.set(symbol, st);
    }
    return st;
  }

  private makeQuote(st: SimState, exactBid?: number, size?: number): Quote {
    const { spec } = st;
    const spread = spec.sim.spreadTicks * spec.tickSize;
    const bid = exactBid ?? roundToTick(st.mid - spread / 2, spec.tickSize);
    const ask = roundToTick(bid + spread, spec.tickSize);
    const last = this.rand() < 0.5 ? bid : ask;
    return { symbol: spec.symbol, bid, ask, last, ts: this.now(), size };
  }

  /** Per-tick sigma (fraction of price) for an average 550 ms tick. */
  private tickSigma(spec: SymbolSpec): number {
    return (spec.sim.dailyVol / Math.sqrt(SECONDS_PER_DAY / 0.55)) * ACTIVITY_BOOST;
  }

  /** Advance one tick. Exposed for tests. */
  step(symbol: string): Quote {
    const st = this.state(symbol);
    if (this.frozen) {
      st.lastQuote = { ...st.lastQuote, ts: this.now() };
      return st.lastQuote;
    }
    if (this.walk === 'gauss') {
      const sigma = this.tickSigma(st.spec);
      st.mid = Math.max(st.spec.tickSize * 10, st.mid * (1 + sigma * gauss(this.rand)));
    } else {
      const n = TICK_WALKS[this.walk].ticks;
      const ticks = Math.floor(this.rand() * (2 * n + 1)) - n;
      st.mid = Math.max(st.spec.tickSize * 10, st.mid + ticks * st.spec.tickSize);
    }
    const size = st.spec.assetClass === 'stock' ? Math.ceil(this.rand() * 300) : Number((this.rand() * 2).toFixed(4));
    st.lastQuote = this.makeQuote(st, undefined, size);
    return st.lastQuote;
  }

  lastQuote(symbol: string): Quote {
    return this.state(symbol).lastQuote;
  }

  private schedule(symbol: string): void {
    const st = this.state(symbol);
    const delay = this.walk === 'gauss' ? 300 + this.rand() * 500 : TICK_WALKS[this.walk].ms;
    st.timer = setTimeout(() => {
      const q = this.step(symbol);
      st.listeners.forEach((l) => l(q));
      if (st.listeners.size > 0) this.schedule(symbol);
      else st.timer = null;
    }, delay);
  }

  subscribe(symbol: string, onQuote: (q: Quote) => void): () => void {
    const st = this.state(symbol);
    st.listeners.add(onQuote);
    // Deliver the current quote immediately so consumers never start empty.
    queueMicrotask(() => {
      if (st.listeners.has(onQuote)) onQuote({ ...st.lastQuote, ts: this.now() });
    });
    if (!st.timer) this.schedule(symbol);
    return () => {
      st.listeners.delete(onQuote);
      if (st.listeners.size === 0 && st.timer) {
        clearTimeout(st.timer);
        st.timer = null;
      }
    };
  }

  async getHistory(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    const st = this.state(symbol);
    const cached = st.history.get(tf);
    if (cached && cached.length >= limit) return cached.slice(-limit);
    const candles = generateHistory(st.spec, st.lastQuote.last, tf, limit, this.now());
    st.history.set(tf, candles);
    return candles;
  }
}

/**
 * Builds `limit` bars ending at `endPrice` by walking backwards from now.
 * Bar volatility scales with sqrt(bar duration); volume is lognormal-ish around a per-class base.
 */
export function generateHistory(spec: SymbolSpec, endPrice: number, tf: Timeframe, limit: number, nowMs: number): Candle[] {
  const rand = mulberry32(hashString(`${spec.symbol}:${tf}`));
  const step = TIMEFRAME_SECONDS[tf];
  const barSigma = spec.sim.dailyVol * Math.sqrt(Math.min(step, 86400) / SECONDS_PER_DAY) * (tf === '1D' ? 1 : 1.4);
  const baseVolume = spec.assetClass === 'stock' ? 40_000 : spec.assetClass === 'crypto' ? 25 : 1_500_000;
  const volScale = Math.sqrt(step / 60);

  const lastBar = barTime(nowMs, tf);
  const closes: number[] = new Array(limit);
  closes[limit - 1] = endPrice;
  for (let i = limit - 2; i >= 0; i--) {
    // walking backwards: previous close = next open ≈ next close / (1 + r)
    const r = barSigma * gauss(rand);
    closes[i] = Math.max(spec.tickSize * 10, closes[i + 1] / (1 + r));
  }

  const candles: Candle[] = [];
  for (let i = 0; i < limit; i++) {
    const open = i === 0 ? closes[0] * (1 + barSigma * 0.3 * gauss(rand)) : closes[i - 1];
    const close = closes[i];
    const wick = Math.abs(barSigma * 0.6 * gauss(rand)) * close;
    const high = Math.max(open, close) + wick * rand();
    const low = Math.min(open, close) - wick * rand();
    candles.push({
      time: lastBar - (limit - 1 - i) * step,
      open: roundToTick(open, spec.tickSize),
      high: roundToTick(high, spec.tickSize),
      low: roundToTick(low, spec.tickSize),
      close: roundToTick(close, spec.tickSize),
      volume: Math.round(baseVolume * volScale * (0.4 + rand() * 1.4) * 100) / 100,
    });
  }
  return candles;
}
