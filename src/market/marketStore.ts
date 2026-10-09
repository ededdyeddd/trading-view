import { create } from 'zustand';
import { FEED_MODE, FINNHUB_KEY, FREEZE, SEED, SIM_WALK, type FeedMode } from '../config/flags';
import { SYMBOLS, getSpec, type FeedKind } from '../config/symbols';
import { BinanceProvider } from './binanceProvider';
import { FinnhubProvider } from './finnhubProvider';
import { SimProvider, mulberry32, type SimWalk } from './simProvider';
import type { Candle, MarketDataProvider, Quote, Timeframe } from './types';

/** A live symbol with no quote for this long is considered dropped and falls back to sim. */
const STALE_MS = 12_000;

export type FeedStatus = {
  /** Feed the symbol was routed to by configuration. */
  configured: FeedKind;
  /** Feed actually delivering quotes now. */
  active: FeedKind;
  /** True when a live feed failed and sim took over — drives the "Simulated data" badge. */
  fellBack: boolean;
  reason?: string;
};

type MarketState = {
  quotes: Record<string, Quote>;
  prevClose: Record<string, number>;
  status: Record<string, FeedStatus>;
  feedMode: FeedMode;
  simWalk: SimWalk;
};

export const useMarketStore = create<MarketState>(() => ({
  quotes: {},
  prevClose: {},
  status: {},
  feedMode: FEED_MODE,
  simWalk: SIM_WALK,
}));

// ---------------------------------------------------------------------------
// Routing + fallback
// ---------------------------------------------------------------------------

// A seed makes the simulated market repeatable (study scenarios); otherwise Math.random.
const sim = new SimProvider({ frozen: FREEZE, random: SEED !== null ? mulberry32(SEED) : undefined, walk: SIM_WALK });

/** Debug: switch how simulated prices move (takes effect from the next tick). */
export function setSimWalk(walk: SimWalk) {
  sim.walk = walk;
  useMarketStore.setState({ simWalk: walk });
}
const binance = new BinanceProvider((symbol, reason) => fallBack(symbol, reason));
const finnhub = FINNHUB_KEY ? new FinnhubProvider(FINNHUB_KEY, (symbol, reason) => fallBack(symbol, reason)) : null;

function configuredFeed(symbol: string): FeedKind {
  const native = getSpec(symbol).liveFeed;
  if (native === 'sim') return 'sim';
  const allowed = FEED_MODE === 'live' || FEED_MODE === native;
  if (!allowed) return 'sim';
  if (native === 'finnhub' && !finnhub) return 'sim';
  return native;
}

function providerFor(feed: FeedKind): MarketDataProvider {
  if (feed === 'binance') return binance;
  if (feed === 'finnhub' && finnhub) return finnhub;
  return sim;
}

type Sub = { feed: FeedKind; unsubscribe: () => void; staleTimer: ReturnType<typeof setTimeout> | null };
const subs = new Map<string, Sub>();

// Quotes are coalesced and flushed once per animation frame so every consumer
// (chart, watchlist, quick-trade, ticket, P&L) renders the same price in the same frame.
let pending: Record<string, Quote> = {};
let flushScheduled = false;
const quoteListeners = new Set<(quotes: Quote[]) => void>();

function flush() {
  flushScheduled = false;
  const batch = pending;
  pending = {};
  const list = Object.values(batch);
  if (list.length === 0) return;
  useMarketStore.setState((s) => ({ quotes: { ...s.quotes, ...batch } }));
  quoteListeners.forEach((l) => l(list));
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  // rAF keeps all consumers in one frame; the timeout guarantees progress when rAF is throttled (background tab).
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => flushScheduled && flush());
  setTimeout(() => flushScheduled && flush(), 100);
}

function onQuote(q: Quote) {
  const sub = subs.get(q.symbol);
  if (sub?.feed !== 'sim') armStale(q.symbol);
  pending[q.symbol] = q;
  scheduleFlush();
}

function armStale(symbol: string) {
  const sub = subs.get(symbol);
  if (!sub || sub.feed === 'sim') return;
  if (sub.staleTimer) clearTimeout(sub.staleTimer);
  sub.staleTimer = setTimeout(() => fallBack(symbol, 'No quotes received'), STALE_MS);
}

function setStatus(symbol: string, patch: Partial<FeedStatus>) {
  useMarketStore.setState((s) => {
    const prev = s.status[symbol] ?? { configured: configuredFeed(symbol), active: configuredFeed(symbol), fellBack: false };
    return { status: { ...s.status, [symbol]: { ...prev, ...patch } } };
  });
}

function startFeed(symbol: string, feed: FeedKind) {
  const provider = providerFor(feed);
  const unsubscribe = provider.subscribe(symbol, onQuote);
  subs.set(symbol, { feed, unsubscribe, staleTimer: null });
  setStatus(symbol, { active: feed });
  if (feed !== 'sim') armStale(symbol);
}

function fallBack(symbol: string, reason: string) {
  const sub = subs.get(symbol);
  if (!sub || sub.feed === 'sim') return;
  if (sub.staleTimer) clearTimeout(sub.staleTimer);
  sub.unsubscribe();
  const last = useMarketStore.getState().quotes[symbol] ?? pending[symbol];
  if (last) sim.anchor(symbol, (last.bid + last.ask) / 2);
  console.info(`[market] ${symbol}: ${sub.feed} → sim (${reason})`);
  startFeed(symbol, 'sim');
  setStatus(symbol, { fellBack: true, reason });
}

let started = false;

/** Subscribes every configured symbol once for the whole app lifetime. */
export function startMarketData() {
  if (started) return;
  started = true;
  for (const spec of SYMBOLS) {
    const feed = configuredFeed(spec.symbol);
    // A live feed was requested for this symbol but cannot run (Finnhub without a key).
    const wanted = spec.liveFeed !== 'sim' && (FEED_MODE === 'live' || FEED_MODE === spec.liveFeed);
    const missingKey = wanted && feed === 'sim';
    setStatus(spec.symbol, {
      configured: wanted ? spec.liveFeed : feed,
      active: feed,
      fellBack: missingKey,
      reason: missingKey ? 'VITE_FINNHUB_KEY is not set' : undefined,
    });
    startFeed(spec.symbol, feed);
    void loadPrevClose(spec.symbol);
  }
}

/** Debug: simulate a live feed outage for every live symbol. */
export function dropLiveFeeds() {
  for (const [symbol, sub] of subs) if (sub.feed !== 'sim') fallBack(symbol, 'Dropped manually (debug)');
}

async function loadPrevClose(symbol: string) {
  try {
    let pc: number | null = null;
    if (subs.get(symbol)?.feed === 'finnhub' && finnhub) pc = await finnhub.getPrevClose(symbol);
    if (pc === null) {
      const daily = await getHistory(symbol, '1D', 2);
      pc = daily.length >= 2 ? daily[daily.length - 2].close : null;
    }
    if (pc !== null) useMarketStore.setState((s) => ({ prevClose: { ...s.prevClose, [symbol]: pc } }));
  } catch {
    /* day change stays empty */
  }
}

/** History from the symbol's active feed; any failure falls back to the simulator. */
export async function getHistory(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const feed = subs.get(symbol)?.feed ?? configuredFeed(symbol);
  if (feed !== 'sim') {
    try {
      const candles = await providerFor(feed).getHistory(symbol, tf, limit);
      if (candles.length > 0) return candles;
    } catch (e) {
      fallBack(symbol, `History failed: ${String(e)}`);
    }
  }
  return sim.getHistory(symbol, tf, limit);
}

/** Low-level listener for every flushed quote batch (used by the paper engine). */
export function onQuotes(listener: (quotes: Quote[]) => void): () => void {
  quoteListeners.add(listener);
  return () => quoteListeners.delete(listener);
}

export function useQuote(symbol: string): Quote | undefined {
  return useMarketStore((s) => s.quotes[symbol]);
}
