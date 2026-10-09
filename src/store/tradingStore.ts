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

export type Toast = EngineEvent & { id: number };

type TradingState = {
  engine: EngineState;
  /** Notifications log (newest last). */
  log: EngineEvent[];
  toasts: Toast[];
  /** Debug time travel offset (ms) applied to the engine clock. */
  clockOffset: number;

  placeOrder: (draft: OrderDraft) => EngineEvent[];
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
function commit(r: EngineResult): EngineEvent[] {
  const store = useTradingStore;
  const toasts = r.events.map((e) => ({ ...e, id: toastSeq++ }));
  const log = [...store.getState().log, ...r.events].slice(-LOG_LIMIT);
  store.setState((s) => ({ engine: r.state, log, toasts: [...s.toasts, ...toasts].slice(-6) }));
  toasts.forEach((t) => setTimeout(() => store.getState().dismissToast(t.id), TOAST_TTL));
  save(r.state, log);
  return r.events;
}

export const useTradingStore = create<TradingState>((set, get) => {
  const quotes = () => useMarketStore.getState().quotes;

  return {
    engine: persisted?.engine ?? createEngineState(),
    log: persisted?.log ?? [],
    toasts: [],
    clockOffset: 0,

    placeOrder: (draft) => commit(enginePlace(get().engine, draft, quotes(), now())),
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
