import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { logEvent, logFieldChange } from '../analytics/eventLog';
import type { PanelVariant } from '../config/flags';
import { getSpec, qtyPrecision, type SymbolSpec } from '../config/symbols';
import type { EngineEvent, TimeInForce } from '../engine/types';
import { offsetInput, parseNum, priceInput } from '../lib/format';
import {
  convertRisk,
  defaultRiskInput,
  floorToStep,
  marketRef,
  type ExitKind,
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
import { CURRENT_RULES, NEW_RULES, deriveTicket, exitInputText } from './deriveTicket';
import { PRICE_COMMIT_MS, evaluatePriceStatus, statusPatch, submitCheck } from './priceField';

export { NEW_EXIT_DEFAULT_PERCENT, exitInputText } from './deriveTicket';
import type { ExitState, PartialState, PriceUnit, TicketState, TicketView } from './types';

/** Level 1 plus this many partial exits. */
export const MAX_PARTIALS = 4;

function defaultQty(spec: SymbolSpec): string {
  if (spec.assetClass === 'crypto') return spec.symbol.startsWith('BTC') ? '0.01' : '0.1';
  if (spec.assetClass === 'forex') return '10000';
  return '1';
}


function initialState(symbol: string, variant: PanelVariant = getVariant()): TicketState {
  if (variant === 'new') {
    return {
      symbol,
      side: 'buy',
      type: 'limit',
      priceInput: '',
      priceUnit: 'price',
      priceStatus: 'ok',
      qtyUnit: 'units',
      qtyInput: '',
      sl: { enabled: false, unit: 'price', input: '', touched: true },
      tp: { enabled: false, unit: 'price', input: '', touched: true },
      tif: 'week',
      gtdDate: '',
      gtdTime: '',
      partials: [],
      fillOutsideRth: false,
    };
  }
  return {
    symbol,
    side: 'buy',
    type: 'limit',
    priceInput: '',
    priceUnit: 'price',
    priceStatus: 'ok',
    qtyUnit: 'units',
    qtyInput: defaultQty(getSpec(symbol)),
    tp: { enabled: false, unit: 'price', input: '', touched: false },
    sl: { enabled: false, unit: 'ticks', input: '25', touched: true },
    tif: 'week',
    gtdDate: '',
    gtdTime: '',
    partials: [],
    fillOutsideRth: false,
  };
}

type Actions = {
  /** Re-targets the ticket to another symbol (keeps side, type and units; resets price). */
  setSymbol: (symbol: string) => void;
  setSide: (side: Side) => void;
  setType: (type: OrderType) => void;
  /** Typing / pasting / stepping; the redesign validates the price PRICE_COMMIT_MS after the last change. */
  setPriceInput: (text: string) => void;
  /** Redesign: validate the price now (blur, arrow / wheel step). */
  commitPrice: () => void;
  /**
   * Redesign, submit click: re-validates the price at the current quote. False = the price just turned bad: show the
   * warning and do not send (the next click sends).
   */
  checkPriceOnSubmit: () => boolean;
  /** ⇆ in the Limit / Stop price field: switch between an absolute price and a signed offset from Ask / Bid; keeps the order price. */
  setPriceUnit: (unit: PriceUnit, view: TicketView) => void;
  /** Partial exits (Level 2+). A new level takes half of Level 1's shares and starts with Level 1's take profit / stop loss. */
  addPartial: (view: TicketView) => void;
  removePartial: (index: number) => void;
  /** Restores a snapshot (Discard in the Exit levels panel). */
  setPartials: (partials: PartialState[]) => void;
  setPartialQty: (index: number, text: string) => void;
  /** Shares ⇆ % of the position; keeps the quantity. */
  setPartialQtyUnit: (index: number, unit: PartialState['qtyUnit'], view: TicketView) => void;
  setPartialLeg: (index: number, kind: ExitKind, text: string) => void;
  /** Level 1's leg from the Exit levels screen: a typed value switches it on, an empty one switches it off. */
  setLevel1Leg: (kind: ExitKind, text: string) => void;
  /** Deletes Level 1: the next level takes its place (its TP / SL become the main ones, its shares join Level 1's remainder). */
  removeLevel1: () => void;
  setPartialLegUnit: (index: number, kind: ExitKind, unit: ExitUnit, view: TicketView) => void;
  setGtdTime: (time: string) => void;
  /** Replace the whole TIF selection (GTD with date and time). */
  setGtd: (date: string, time: string) => void;
  /** Fills an empty price with Ask (buy) / Bid (sell) in production; the redesign keeps it empty (grey placeholder). */
  ensurePrice: () => void;
  setQtyInput: (text: string) => void;
  setQtyUnit: (unit: QtyUnit, view: TicketView) => void;
  /**
   * In the redesign, switching a level on fills its placeholder (the last value, else SL −2% / TP +4%);
   * switching it off keeps the value, which stays as the grey placeholder. Switching quantity to a risk unit turns SL on.
   */
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
  /** Applies one of the priceField rules at the live quote. */
  applyPricePatch: (patch: typeof statusPatch) => void;
};


function liveQuote(symbol: string): Quote | undefined {
  return useMarketStore.getState().quotes[symbol];
}

let commitTimer: ReturnType<typeof setTimeout> | null = null;
function cancelPriceCommit() {
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = null;
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
        priceStatus: 'ok',
        qtyInput: '',
        sl: { ...s.sl, enabled: false, input: '' },
        tp: { ...s.tp, enabled: false, input: '' },
        partials: [],
      }));
      cancelPriceCommit();
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
    if (getVariant() === 'new') get().applyPricePatch(statusPatch);
    logEvent('side_change', { side });
  },
  setType: (type) => {
    if (type === get().type) return;
    set({ type });
    if (getVariant() === 'new') get().applyPricePatch(statusPatch);
    else get().ensurePrice();
    logEvent('type_change', { type });
  },
  setPriceUnit: (unit, view) => {
    const s = get();
    if (unit === s.priceUnit) return;
    const spec = getSpec(s.symbol);
    let text = '';
    if (view.price?.value != null) {
      text = unit === 'price' ? priceInput(view.price.value, spec) : offsetInput(view.price.offset ?? 0, spec);
    }
    set({ priceUnit: unit, priceInput: text });
    logEvent('unit_change', { field: 'price', unit });
  },
  addPartial: (view) => {
    const s = get();
    if (s.partials.length >= MAX_PARTIALS) return;
    const spec = getSpec(s.symbol);
    const half = Math.max(spec.minQty, floorToStep(view.level1Qty / 2, spec.qtyStep));
    const leg = (kind: ExitKind) => ({ unit: s[kind].unit, input: s[kind].enabled ? view[kind].input : '' });
    set({ partials: [...s.partials, { qtyInput: half.toFixed(qtyPrecision(spec)), qtyUnit: 'units', tp: leg('tp'), sl: leg('sl') }] });
    logEvent('field_change', { field: 'partials', value: s.partials.length + 1 });
  },
  removePartial: (index) => {
    set((s) => ({ partials: s.partials.filter((_, i) => i !== index) }));
    logEvent('field_change', { field: 'partials', value: get().partials.length });
  },
  setPartials: (partials) => set({ partials }),
  setLevel1Leg: (kind, text) => {
    set((s) => ({ [kind]: { ...s[kind], input: text, enabled: text.trim() !== '', touched: true } }) as Partial<TicketState>);
    logFieldChange(`level1${kind}`, text);
  },
  removeLevel1: () => {
    const s = get();
    const next = s.partials[0];
    if (!next) return;
    const leg = (kind: ExitKind): ExitState => ({ enabled: next[kind].input.trim() !== '', unit: next[kind].unit, input: next[kind].input, touched: true });
    set({ tp: leg('tp'), sl: leg('sl'), partials: s.partials.slice(1) });
    logEvent('field_change', { field: 'partials', value: s.partials.length });
  },
  setPartialQty: (index, text) => {
    set((s) => ({ partials: s.partials.map((p, i) => (i === index ? { ...p, qtyInput: text } : p)) }));
    logFieldChange(`partial${index + 2}Qty`, text);
  },
  setPartialQtyUnit: (index, unit, view) => {
    const s = get();
    const p = s.partials[index];
    if (!p || p.qtyUnit === unit) return;
    const v = view.partials[index];
    const spec = getSpec(s.symbol);
    const text = !v || !(v.qty > 0) ? '' : unit === 'units' ? v.qty.toFixed(qtyPrecision(spec)) : v.percent.toFixed(2);
    set({ partials: s.partials.map((x, i) => (i === index ? { ...x, qtyUnit: unit, qtyInput: text } : x)) });
  },
  setPartialLeg: (index, kind, text) => {
    set((s) => ({ partials: s.partials.map((p, i) => (i === index ? { ...p, [kind]: { ...p[kind], input: text } } : p)) }));
    logFieldChange(`partial${index + 2}${kind}`, text);
  },
  setPartialLegUnit: (index, kind, unit, view) => {
    const s = get();
    const p = s.partials[index];
    if (!p || p[kind].unit === unit) return;
    const lvl = view.partials[index]?.[kind].level;
    const text = lvl && !lvl.invalid ? exitInputText(lvl, unit, getSpec(s.symbol)) : '';
    set({ partials: s.partials.map((x, i) => (i === index ? { ...x, [kind]: { unit, input: text } } : x)) });
    logEvent('unit_change', { field: `partial${index + 2}${kind}`, unit });
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
    if (getVariant() === 'new') {
      cancelPriceCommit();
      commitTimer = setTimeout(() => get().commitPrice(), PRICE_COMMIT_MS);
    }
    logFieldChange('price', text);
  },
  commitPrice: () => {
    cancelPriceCommit();
    const s = get();
    const priceStatus = evaluatePriceStatus(s, liveQuote(s.symbol), getSpec(s.symbol));
    if (priceStatus !== s.priceStatus) set({ priceStatus });
  },
  checkPriceOnSubmit: () => {
    cancelPriceCommit();
    const s = get();
    const res = submitCheck(s, liveQuote(s.symbol), getSpec(s.symbol));
    if (res.priceStatus !== s.priceStatus) set({ priceStatus: res.priceStatus });
    return res.send;
  },
  applyPricePatch: (patch) => {
    const s = get();
    const next = patch(s, liveQuote(s.symbol), getSpec(s.symbol));
    if (next) set(next);
  },
  ensurePrice: () => {
    const s = get();
    if (getVariant() === 'new') return; // the redesign leaves an empty price empty: it shows a grey placeholder
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
    const toRisk = unit === 'riskMoney' || unit === 'riskBalancePercent';
    const fromRisk = s.qtyUnit === 'riskMoney' || s.qtyUnit === 'riskBalancePercent';
    if (getVariant() === 'new' && toRisk) {
      // Redesign: a risk input starts at 1% of balance (never derived from the position or margin); between the two
      // risk units the typed risk converts.
      const typed = parseNum(s.qtyInput);
      if (fromRisk && Number.isFinite(typed)) text = convertRisk(typed, unit, view.balance).toFixed(unit === 'riskMoney' ? 0 : 2);
      else text = defaultRiskInput(unit, view.balance);
    } else if (view.qty.units > 0) {
      if (unit === 'units') text = view.qty.units.toFixed(qtyPrecision(spec));
      else if (unit === 'value') text = eq.value.toFixed(2);
      else if (unit === 'balancePercent') text = eq.balancePercent.toFixed(2);
      else if (unit === 'riskMoney') text = eq.riskMoney !== null ? eq.riskMoney.toFixed(2) : '';
      else text = eq.riskBalancePercent !== null ? eq.riskBalancePercent.toFixed(2) : '';
    }
    set({ qtyUnit: unit, qtyInput: text });
    // Redesign: risk sizing excludes a stop loss in money units (the risk sets the quantity, not the level) — keep its level,
    // as a price. Take profit is not restricted.
    if (getVariant() === 'new' && toRisk) {
      const ex = s.sl;
      if (ex.unit === 'money' || ex.unit === 'balancePercent') {
        const lvl = view.sl.level ?? view.sl.placeholderLevel;
        const input = lvl && !lvl.invalid ? exitInputText(lvl, 'price', spec) : '';
        set({ sl: { ...ex, unit: 'price', input } });
      }
    }
    // Redesign: risk sizing needs a stop loss — switch it on with its placeholder (the last value, else −2% from entry).
    if (getVariant() === 'new' && toRisk && !get().sl.enabled) get().setExitEnabled('sl', true, view);
    logEvent('unit_change', { field: 'quantity', unit });
  },
  setExitEnabled: (kind, enabled, view) => {
    const s = get();
    let input = s[kind].input;
    if (getVariant() === 'new' && enabled && input.trim() === '') input = view?.[kind].placeholder ?? '';
    set({ [kind]: { ...s[kind], enabled, input, touched: true } } as Partial<TicketState>);
    logEvent('toggle_change', { field: kind, enabled });
  },
  clearQty: () => set({ qtyInput: '', partials: [] }),
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
  cancelPriceCommit();
  useTicketStore.setState(initialState(useTicketStore.getState().symbol, s.variant));
  useTicketStore.getState().ensurePrice();
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
  // Placeholders and live values in unit menus follow the market at most every 500 ms (user edits apply at once).
  const heldQuote = useThrottled(liveQuote, isNew ? 500 : 0);
  const slowQuote = heldQuote?.symbol === state.symbol ? heldQuote : liveQuote;
  const slowView = useMemo(
    () =>
      slowQuote === quote
        ? view
        : deriveTicket(state, {
            quote: slowQuote,
            spec,
            balance: account.balance,
            availableFunds: account.availableFunds,
            now: t,
            rules: isNew ? NEW_RULES : CURRENT_RULES,
            opensAt,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, slowQuote],
  );
  // The price field's "Ask − 2.57" label refreshes at most once a second.
  const heldLabelQuote = useThrottled(liveQuote, isNew ? 1000 : 0);
  const labelQuote = heldLabelQuote?.symbol === state.symbol ? heldLabelQuote : liveQuote;
  return { state, view, slowView, labelQuote, spec, quote: liveQuote, account };
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
