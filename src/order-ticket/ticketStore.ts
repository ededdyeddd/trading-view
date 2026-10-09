import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { logEvent, logFieldChange } from '../analytics/eventLog';
import type { PanelVariant } from '../config/flags';
import { getSpec, pricePrecision, qtyPrecision, type SymbolSpec } from '../config/symbols';
import type { EngineEvent, TimeInForce } from '../engine/types';
import { priceInput } from '../lib/format';
import {
  defaultExitPrice,
  defaultLevelPercents,
  describeExit,
  exitValueInUnit,
  marketRef,
  type ExitKind,
  type ExitLevel,
  type ExitUnit,
  type OrderType,
  type QtyUnit,
  type Side,
} from '../lib/orderMath';
import { useMarketStore } from '../market/marketStore';
import { now, useAccountSummary, useTradingStore } from '../store/tradingStore';
import { uiEvents, useUiStore } from '../store/uiStore';
import { getVariant, useVariantStore } from '../store/variantStore';
import { sessionOpensAt } from '../market/session';
import type { Quote } from '../market/types';
import { CURRENT_RULES, NEW_RULES, deriveTicket } from './deriveTicket';
import type { ExitState, PriceUnit, TicketState, TicketView } from './types';

function defaultQty(spec: SymbolSpec): string {
  if (spec.assetClass === 'crypto') return spec.symbol.startsWith('BTC') ? '0.01' : '0.1';
  if (spec.assetClass === 'forex') return '10000';
  return '1';
}

/** Redesign defaults when a level is switched on: SL 2% and TP 4% from entry. */
export const NEW_EXIT_DEFAULT_PERCENT: Record<ExitKind, number> = { sl: 2, tp: 4 };

function initialState(symbol: string, variant: PanelVariant = getVariant()): TicketState {
  if (variant === 'new') {
    return {
      symbol,
      side: 'buy',
      type: 'market',
      priceInput: '',
      priceUnit: 'price',
      qtyUnit: 'units',
      qtyInput: '',
      sl: { enabled: false, unit: 'price', input: '', touched: true },
      tp: { enabled: false, unit: 'price', input: '', touched: true },
      tif: 'week',
      gtdDate: '',
      gtdTime: '',
      tpPercent: '',
      tpLevels: [],
      fillOutsideRth: false,
    };
  }
  return {
    symbol,
    side: 'buy',
    type: 'limit',
    priceInput: '',
    priceUnit: 'price',
    qtyUnit: 'units',
    qtyInput: defaultQty(getSpec(symbol)),
    tp: { enabled: false, unit: 'price', input: '', touched: false },
    sl: { enabled: false, unit: 'ticks', input: '25', touched: true },
    tif: 'week',
    gtdDate: '',
    gtdTime: '',
    tpPercent: '',
    tpLevels: [],
    fillOutsideRth: false,
  };
}

type Actions = {
  /** Re-targets the ticket to another symbol (keeps side, type and units; resets price). */
  setSymbol: (symbol: string) => void;
  setSide: (side: Side) => void;
  setType: (type: OrderType) => void;
  setPriceInput: (text: string) => void;
  /** Switch Limit/Stop price input between an absolute price and a tick offset; keeps the order price. */
  setPriceUnit: (unit: PriceUnit, view: TicketView) => void;
  /** Add TP 2 / TP 3 (max 3 levels): levels share the position equally. */
  addTpLevel: (view: TicketView) => void;
  removeTpLevel: (index: number) => void;
  /** index 0 = TP 1. Input over what is left is capped. */
  setTpPercent: (index: number, text: string) => void;
  setTpLevelInput: (index: number, text: string) => void;
  setGtdTime: (time: string) => void;
  /** Replace the whole TIF selection (GTD with date and time). */
  setGtd: (date: string, time: string) => void;
  /** Fills an empty price with the current market reference (Ask for buy, Bid for sell). */
  ensurePrice: () => void;
  setQtyInput: (text: string) => void;
  setQtyUnit: (unit: QtyUnit, view: TicketView) => void;
  /** In the redesign, switching a level on fills the default (SL −2% / TP +4%) and switching off clears it. */
  setExitEnabled: (kind: ExitKind, enabled: boolean, view?: TicketView) => void;
  /** After a submit the redesign keeps side, type and units but clears the quantity. */
  clearQty: () => void;
  setExitInput: (kind: ExitKind, text: string) => void;
  setExitUnit: (kind: ExitKind, unit: ExitUnit, view: TicketView) => void;
  setTif: (tif: TimeInForce) => void;
  setGtdDate: (date: string) => void;
  setFillOutsideRth: (v: boolean) => void;
  /** Submits the derived draft to the paper engine. */
  submit: (view: TicketView, opts?: { silent?: boolean }) => EngineEvent[];
};

/** Text a level has in an input unit: prices to tick precision, ticks as integers, the rest to 2 decimals. */
export function exitInputText(level: ExitLevel, unit: ExitUnit, spec: SymbolSpec): string {
  const v = exitValueInUnit(level, unit);
  if (unit === 'price') return v.toFixed(pricePrecision(spec));
  if (unit === 'ticks') return String(v);
  return v.toFixed(2);
}

function accountBalance(): number {
  return useTradingStore.getState().engine.balance;
}

export const useTicketStore = create<TicketState & Actions>((set, get) => ({
  ...initialState(useUiStore.getState().symbol),

  setSymbol: (symbol) => {
    if (symbol === get().symbol) return;
    const spec = getSpec(symbol);
    if (getVariant() === 'new') {
      // Levels are prices of the previous symbol — start the new one clean, keep side/type/units.
      set((s) => ({
        symbol,
        priceInput: '',
        qtyInput: '',
        sl: { ...s.sl, enabled: false, input: '' },
        tp: { ...s.tp, enabled: false, input: '' },
        tpLevels: [],
        tpPercent: '',
      }));
      return;
    }
    set((s) => ({
      symbol,
      priceInput: '',
      qtyInput: s.qtyUnit === 'units' ? defaultQty(spec) : s.qtyInput,
      tp: { ...s.tp, touched: s.tp.unit === 'price' ? false : s.tp.touched },
      sl: s.sl.unit === 'price' ? { ...s.sl, unit: 'ticks', input: '25', touched: true } : s.sl,
    }));
    get().ensurePrice();
  },
  setSide: (side) => {
    if (side === get().side) return;
    set({ side });
    logEvent('side_change', { side });
  },
  setType: (type) => {
    if (type === get().type) return;
    set({ type });
    // The redesign keeps the price empty (placeholder = live Ask/Bid); production pre-fills it.
    if (getVariant() !== 'new') get().ensurePrice();
    logEvent('type_change', { type });
  },
  setPriceUnit: (unit, view) => {
    const s = get();
    if (unit === s.priceUnit) return;
    const spec = getSpec(s.symbol);
    let text = '';
    if (view.price?.value != null) {
      text = unit === 'price' ? priceInput(view.price.value, spec) : String(Math.abs(view.price.offsetTicks ?? 0));
    }
    set({ priceUnit: unit, priceInput: text });
    logEvent('unit_change', { field: 'price', unit });
  },
  addTpLevel: (view) => {
    const s = get();
    if (s.tpLevels.length >= 2) return;
    const n = s.tpLevels.length + 2;
    const pct = defaultLevelPercents(n);
    // A new level starts one more TP-distance further out than the last one.
    const last = view.tpLevels[view.tpLevels.length - 1]?.level;
    let input = '';
    if (last && view.entry !== null && !last.invalid) {
      const spec = getSpec(s.symbol);
      const step = last.price - view.entry;
      const next = describeExit(
        'tp',
        s.side,
        view.entry,
        1,
        Math.round((last.price + step / Math.max(1, n - 1)) / spec.tickSize) * spec.tickSize,
        accountBalance(),
        spec,
      );
      input = exitInputText(next, s.tp.unit, spec);
    }
    set({
      tpPercent: String(pct[0]),
      tpLevels: [...s.tpLevels.map((l, i) => ({ ...l, percent: String(pct[i + 1]) })), { input, percent: String(pct[n - 1]) }],
    });
    logEvent('field_change', { field: 'tpLevels', value: n });
  },
  removeTpLevel: (index) => {
    const s = get();
    const levels = s.tpLevels.filter((_, i) => i !== index - 1);
    const pct = defaultLevelPercents(levels.length + 1);
    set({ tpLevels: levels.map((l, i) => ({ ...l, percent: String(pct[i + 1]) })), tpPercent: levels.length ? String(pct[0]) : '' });
    logEvent('field_change', { field: 'tpLevels', value: levels.length + 1 });
  },
  setTpPercent: (index, text) => {
    const s = get();
    const all = [s.tpPercent, ...s.tpLevels.map((l) => l.percent)];
    const others = all.reduce((a, p, i) => (i === index ? a : a + (Number(p) || 0)), 0);
    let v = text.replace(/[^\d]/g, '');
    if (v !== '' && Number(v) > 100 - others) v = String(Math.max(0, 100 - others));
    if (index === 0) set({ tpPercent: v });
    else set({ tpLevels: s.tpLevels.map((l, i) => (i === index - 1 ? { ...l, percent: v } : l)) });
    logFieldChange(`tpPercent${index + 1}`, v);
  },
  setTpLevelInput: (index, text) => {
    set((s) => ({ tpLevels: s.tpLevels.map((l, i) => (i === index - 1 ? { ...l, input: text } : l)) }));
    logFieldChange(`tp${index + 1}`, text);
  },
  setGtdTime: (gtdTime) => {
    set({ gtdTime });
    logFieldChange('gtdTime', gtdTime);
  },
  setGtd: (gtdDate, gtdTime) => {
    set({ tif: 'gtd', gtdDate, gtdTime });
    logEvent('field_change', { field: 'tif', value: 'gtd', date: gtdDate, time: gtdTime });
  },
  setPriceInput: (text) => {
    set({ priceInput: text });
    logFieldChange('price', text);
  },
  ensurePrice: () => {
    const s = get();
    if (s.priceInput !== '') return;
    const q = useMarketStore.getState().quotes[s.symbol];
    if (!q) return;
    set({ priceInput: priceInput(marketRef(s.side, q.bid, q.ask), getSpec(s.symbol)) });
  },
  setQtyInput: (text) => {
    set({ qtyInput: text });
    logFieldChange('quantity', text);
  },
  setQtyUnit: (unit, view) => {
    const s = get();
    if (unit === s.qtyUnit) return;
    const spec = getSpec(s.symbol);
    const eq = view.qty.equivalents;
    let text = '';
    if (view.qty.units > 0) {
      if (unit === 'units') text = view.qty.units.toFixed(qtyPrecision(spec));
      else if (unit === 'value') text = eq.value.toFixed(2);
      else if (unit === 'balancePercent') text = eq.balancePercent.toFixed(2);
      else if (unit === 'riskMoney') text = eq.riskMoney !== null ? eq.riskMoney.toFixed(2) : '';
      else text = eq.riskBalancePercent !== null ? eq.riskBalancePercent.toFixed(2) : '';
    }
    set({ qtyUnit: unit, qtyInput: text });
    logEvent('unit_change', { field: 'quantity', unit });
  },
  setExitEnabled: (kind, enabled, view) => {
    const s = get();
    let input = s[kind].input;
    if (getVariant() === 'new') {
      input = '';
      if (enabled && view?.entry) {
        const spec = getSpec(s.symbol);
        const price = defaultExitPrice(kind, s.side, view.entry, NEW_EXIT_DEFAULT_PERCENT[kind], spec.tickSize);
        const qty = view.qty.units > 0 ? view.qty.units : 1;
        const lvl = describeExit(kind, s.side, view.entry, qty, price, accountBalance(), spec);
        input = exitInputText(lvl, s[kind].unit, spec);
      }
    }
    set({ [kind]: { ...s[kind], enabled, input, touched: true } } as Partial<TicketState>);
    if (kind === 'tp' && !enabled) set({ tpLevels: [], tpPercent: '' });
    logEvent('toggle_change', { field: kind, enabled });
  },
  clearQty: () => set({ qtyInput: '' }),
  setExitInput: (kind, text) => {
    set((s) => ({ [kind]: { ...s[kind], input: text, touched: true } }) as Partial<TicketState>);
    logFieldChange(kind, text);
  },
  setExitUnit: (kind, unit, view) => {
    const s = get();
    const ex: ExitState = s[kind];
    if (unit === ex.unit) return;
    const lvl = view[kind].level;
    const spec = getSpec(s.symbol);
    const text = lvl && !lvl.invalid ? exitInputText(lvl, unit, spec) : '';
    set({ [kind]: { ...ex, unit, input: text, touched: true } } as Partial<TicketState>);
    if (kind === 'tp' && s.tpLevels.length) {
      set({
        tpLevels: s.tpLevels.map((l, i) => {
          const lv = view.tpLevels[i + 1]?.level;
          return { ...l, input: lv && !lv.invalid ? exitInputText(lv, unit, spec) : '' };
        }),
      });
    }
    logEvent('unit_change', { field: kind, unit });
  },
  setTif: (tif) => {
    set({ tif });
    logEvent('field_change', { field: 'tif', value: tif });
  },
  setGtdDate: (gtdDate) => {
    set({ gtdDate });
    logFieldChange('gtdDate', gtdDate);
  },
  setFillOutsideRth: (fillOutsideRth) => {
    set({ fillOutsideRth });
    logEvent('toggle_change', { field: 'fillOutsideRth', enabled: fillOutsideRth });
  },
  submit: (view, opts) => {
    if (!view.draft) return [];
    const q = useMarketStore.getState().quotes[view.draft.symbol];
    logEvent('submit', { draft: view.draft, market: q ? { bid: q.bid, ask: q.ask } : null });
    const events = useTradingStore.getState().placeOrder(view.draft, opts);
    const rejected = events.find((e) => e.type === 'rejected');
    logEvent('submit_result', { result: rejected ? 'rejected' : 'accepted', message: rejected?.message, orderId: events[0]?.order?.id });
    return events;
  },
}));

// Ticket lifecycle is driven by the UI store.
uiEvents.onTicketOpen.add((source, side) => {
  const t = useTicketStore.getState();
  t.setSymbol(useUiStore.getState().symbol);
  if (side) useTicketStore.setState({ side });
  t.ensurePrice();
  logEvent('ticket_open', { source, side: side ?? useTicketStore.getState().side, symbol: useTicketStore.getState().symbol });
});
uiEvents.onTicketClose.add(() => logEvent('ticket_close'));
// Switching panels starts the ticket over with that panel's defaults (same symbol).
useVariantStore.subscribe((s, prev) => {
  if (s.variant === prev.variant) return;
  useTicketStore.setState(initialState(useTicketStore.getState().symbol, s.variant));
  if (s.variant === 'current') useTicketStore.getState().ensurePrice();
  logEvent('panel_switch', { panel: s.variant });
});
useUiStore.subscribe((s, prev) => {
  if (s.symbol !== prev.symbol) {
    useTicketStore.getState().setSymbol(s.symbol);
    logEvent('symbol_change', { symbol: s.symbol });
  }
});

/**
 * The single contract every order panel variant uses: raw state, derived view, actions.
 * Re-derives on every flushed quote so prices match the chart, watchlist and P&L.
 */
export function useOrderTicket() {
  const state = useTicketStore();
  const liveQuote = useMarketStore((s) => s.quotes[state.symbol]);
  const account = useAccountSummary();
  const spec = getSpec(state.symbol);
  const isNew = useVariantStore((s) => s.variant) === 'new';
  // Risk sizing at Market floats with the market: re-derive the quantity at most every 500 ms.
  const throttle = isNew && state.type === 'market' && (state.qtyUnit === 'riskMoney' || state.qtyUnit === 'riskBalancePercent');
  const quote = useThrottled(liveQuote, throttle ? 500 : 0);
  const t = now();
  const opensAt = sessionOpensAt(state.symbol, t);
  const view = useMemo(
    () =>
      deriveTicket(state, {
        quote,
        spec,
        balance: account.balance,
        availableFunds: account.availableFunds,
        now: t,
        rules: isNew ? NEW_RULES : CURRENT_RULES,
        opensAt,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, quote, spec, account.balance, account.availableFunds, isNew, opensAt],
  );
  return { state, view, spec, quote: liveQuote, account };
}

/** Passes `value` through at most once per `ms` (0 = no throttling); the latest value always lands. */
function useThrottled(value: Quote | undefined, ms: number): Quote | undefined {
  const [held, setHeld] = useState(value);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (ms === 0) return;
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setHeld(value);
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        last.current = Date.now();
        setHeld(useMarketStore.getState().quotes[value?.symbol ?? ''] ?? value);
      }, wait);
    }
  }, [value, ms]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return ms === 0 ? value : held;
}

export type OrderTicket = ReturnType<typeof useOrderTicket>;
