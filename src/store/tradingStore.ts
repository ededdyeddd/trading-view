import { create } from 'zustand';
import { logEvent } from '../analytics/eventLog';
import {
  accountSummary,
  cancelOrder as engineCancel,
  closePosition as engineClose,
  createEngineState,
  expireOrders,
  modifyOrder as engineModify,
  onQuote,
  placeOrder as enginePlace,
  type OrderPatch,
} from '../engine/paperEngine';
import type { AccountSummary, EngineEvent, EngineResult, EngineState, OrderDraft } from '../engine/types';
import { onQuotes, useMarketStore } from '../market/marketStore';

const STORAGE_KEY = 'paper-trading:v1';
const LOG_LIMIT = 500;

export type ToastAction = { label: string; run: () => void };
/** Engine notification or a panel-specific toast (title + optional action button). */
export type Toast = EngineEvent & { id: number; title?: string; action?: ToastAction; ttl?: number };
export type ToastInput = Omit<Toast, 'id'>;

type TradingState = {
  engine: EngineState;
  /** Notifications log (newest last). */
  log: EngineEvent[];
  toasts: Toast[];
  /** Debug time travel offset (ms) applied to the engine clock. */
  clockOffset: number;

  /** `silent` skips the default engine toasts (the caller shows its own). */
  placeOrder: (draft: OrderDraft, opts?: { silent?: boolean }) => EngineEvent[];
  /** Undo a filled market entry: cancels its bracket legs and sends the opposite market order. */
  reverseTrade: (orderId: string) => EngineEvent[];
  pushToast: (toast: ToastInput) => void;
  cancelOrder: (id: string) => void;
  modifyOrder: (id: string, patch: OrderPatch) => void;
  closePosition: (symbol: string) => void;
  resetAccount: () => void;
  dismissToast: (id: number) => void;
  advanceClock: (ms: number) => void;
};

function load(): { engine: EngineState; log: EngineEvent[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { engine: EngineState; log: EngineEvent[] };
    if (!parsed?.engine?.orders) return null;
    return parsed;
  } catch {
    return null;
  }
}

function save(engine: EngineState, log: EngineEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ engine, log }));
  } catch {
    /* storage unavailable (private mode, quota) — state stays in memory */
  }
}

let toastSeq = 1;
const TOAST_TTL = 5000;

export function now(): number {
  return Date.now() + useTradingStore.getState().clockOffset;
}

const persisted = load();

/** Applies an engine result: state, notifications log, toasts, persistence. */
function commit(r: EngineResult, opts: { silent?: boolean } = {}): EngineEvent[] {
  const store = useTradingStore;
  const log = [...store.getState().log, ...r.events].slice(-LOG_LIMIT);
  store.setState({ engine: r.state, log });
  if (!opts.silent) r.events.forEach((e) => showToast(e));
  save(r.state, log);
  return r.events;
}

function showToast(t: ToastInput) {
  const store = useTradingStore;
  const toast: Toast = { ...t, id: toastSeq++ };
  store.setState((s) => ({ toasts: [...s.toasts, toast].slice(-6) }));
  setTimeout(() => store.getState().dismissToast(toast.id), toast.ttl ?? TOAST_TTL);
}

export const useTradingStore = create<TradingState>((set, get) => {
  const quotes = () => useMarketStore.getState().quotes;

  return {
    engine: persisted?.engine ?? createEngineState(),
    log: persisted?.log ?? [],
    toasts: [],
    clockOffset: 0,

    placeOrder: (draft, opts) => commit(enginePlace(get().engine, draft, quotes(), now()), opts),
    reverseTrade: (orderId) => {
      const entry = get().engine.orders.find((o) => o.id === orderId);
      if (!entry || entry.status !== 'filled') return [];
      logEvent('position_close', { symbol: entry.symbol, fromOrderId: orderId });
      let state = get().engine;
      const events: EngineEvent[] = [];
      for (const leg of state.orders.filter((o) => o.parentId === orderId && o.status === 'working')) {
        const r = engineCancel(state, leg.id, now());
        state = r.state;
        events.push(...r.events);
      }
      const opposite: OrderDraft = { symbol: entry.symbol, side: entry.side === 'buy' ? 'sell' : 'buy', type: 'market', qty: entry.qty, tif: 'day' };
      const r = enginePlace(state, opposite, quotes(), now());
      return commit({ state: r.state, events: [...events, ...r.events] }, { silent: true });
    },
    pushToast: (toast) => showToast(toast),
    cancelOrder: (id) => {
      logEvent('order_cancel', { orderId: id });
      commit(engineCancel(get().engine, id, now()));
    },
    modifyOrder: (id, patch) => {
      logEvent('order_modify', { orderId: id, patch });
      commit(engineModify(get().engine, id, patch, quotes(), now()));
    },
    closePosition: (symbol) => {
      logEvent('position_close', { symbol });
      commit(engineClose(get().engine, symbol, quotes(), now()));
    },
    resetAccount: () => {
      const engine = createEngineState();
      set({ engine, log: [], toasts: [] });
      save(engine, []);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    advanceClock: (ms) => {
      set((s) => ({ clockOffset: s.clockOffset + ms }));
      const r = expireOrders(get().engine, now());
      if (r.events.length) commit(r);
    },
  };
});

let started = false;

/** Wires the engine to the market: matches orders on every flushed quote and expires orders once a second. */
export function startTrading() {
  if (started) return;
  started = true;
  onQuotes((batch) => {
    let state = useTradingStore.getState().engine;
    if (!state.orders.some((o) => o.status === 'working')) return;
    const events: EngineEvent[] = [];
    const t = now();
    for (const q of batch) {
      const r = onQuote(state, q, t);
      state = r.state;
      events.push(...r.events);
    }
    if (events.length) commit({ state, events });
  });
  setInterval(() => {
    const r = expireOrders(useTradingStore.getState().engine, now());
    if (r.events.length) commit(r);
  }, 1000);
  // Orders that expired while the tab was closed.
  const r = expireOrders(useTradingStore.getState().engine, now());
  if (r.events.length) commit(r);
}

/** Account metrics recomputed from the same quotes the UI renders. */
export function useAccountSummary(): AccountSummary {
  const engine = useTradingStore((s) => s.engine);
  const quotes = useMarketStore((s) => s.quotes);
  return accountSummary(engine, quotes);
}
