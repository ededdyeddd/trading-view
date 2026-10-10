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
  nextLevel,
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
import type { ExitState, LevelState, PriceUnit, TicketState, TicketView } from './types';

/** Most levels a ticket can have. */
export const MAX_LEVELS = 5;

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
      levels: [],
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
    levels: [],
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
  /**
   * "+ Add partial exit": the last level's shares are halved (rounded down, the rest stays with it), the new level copies
   * its SL and puts its TP one step further. The first call turns the SL / TP fields into level 1. Returns the data index
   * of the new level, or null when the shares cannot be split.
   */
  addLevel: (view: TicketView) => number | null;
  /** Deletes a level; its shares go to the previous one in the list (the next one for the first). One level left → the SL / TP fields. */
  removeLevel: (index: number, view: TicketView) => void;
  /** Restores a snapshot (Discard in the level editor). */
  setLevels: (levels: LevelState[]) => void;
  /** Level shares typed by the user; the other levels keep their shares. 0 / empty leaves the level to be dropped by `pruneLevels`. */
  setLevelQty: (index: number, text: string, view: TicketView) => void;
  /** Drops levels with no shares; one level left → the SL / TP fields. */
  pruneLevels: (view: TicketView) => void;
  setLevelLeg: (index: number, kind: ExitKind, text: string) => void;
  setLevelLegUnit: (index: number, kind: ExitKind, unit: ExitUnit, view: TicketView) => void;
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
        levels: [],
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
  addLevel: (view) => {
    const s = get();
    const spec = getSpec(s.symbol);
    const units = view.qty.units;
    if (s.levels.length >= MAX_LEVELS || !(units > 0) || view.levelEntry === null) return null;
    const entry = view.levelEntry;
    const price = (n: number | null) => (n === null ? '' : priceInput(n, spec));
    // Single level: its SL / TP fields become level 1.
    const single = s.levels.length === 0;
    const base: LevelState[] = single
      ? [{ frac: 1, tp: { unit: s.tp.unit, input: s.tp.enabled ? view.tp.input : '' }, sl: { unit: s.sl.unit, input: s.sl.enabled ? view.sl.input : '' } }]
      : s.levels;
    const qtys = single ? [units] : view.levels.map((l) => l.qty);
    const tps = single ? [view.tp.enabled && view.tp.level && !view.tp.level.invalid ? view.tp.level.price : null] : view.levels.map((l) => (l.tp.level && !l.tp.level.invalid ? l.tp.level.price : null));
    const sls = single ? [view.sl.enabled && view.sl.level && !view.sl.level.invalid ? view.sl.level.price : null] : view.levels.map((l) => (l.sl.level && !l.sl.level.invalid ? l.sl.level.price : null));
    const order = single ? [0] : view.levelOrder;
    const lastI = order[order.length - 1];
    const prevTp = order.length > 1 ? tps[order[order.length - 2]] : null;
    const next = nextLevel({ qty: qtys[lastI], tp: tps[lastI], sl: sls[lastI] }, prevTp, entry, spec.qtyStep, spec.tickSize);
    if (!next) return null;
    const levels = base.map((l, i) => (i === lastI ? { ...l, frac: next.lastQty / units } : l));
    // The new level's legs are prices (SL copied from the last level; TP one step further).
    levels.push({ frac: next.newQty / units, tp: { unit: 'price', input: price(next.tp) }, sl: { unit: 'price', input: price(next.sl) } });
    set({ levels });
    logEvent('field_change', { field: 'levels', value: levels.length });
    return levels.length - 1;
  },
  removeLevel: (index, view) => {
    const s = get();
    if (!s.levels[index]) return;
    const order = view.levelOrder;
    const pos = order.indexOf(index);
    const neighbour = order[pos - 1] ?? order[pos + 1];
    const levels = s.levels
      .map((l, i) => (i === neighbour ? { ...l, frac: l.frac + s.levels[index].frac } : l))
      .filter((_, i) => i !== index);
    set({ levels });
    get().pruneLevels({ ...view, levels: view.levels.filter((_, i) => i !== index) });
    logEvent('field_change', { field: 'levels', value: levels.length });
  },
  setLevels: (levels) => set({ levels }),
  setLevelQty: (index, text, view) => {
    const s = get();
    const units = view.qty.units;
    if (!(units > 0) || !s.levels[index]) return;
    const n = parseNum(text);
    const spec = getSpec(s.symbol);
    const typed = Number.isFinite(n) && n > 0 ? floorToStep(n, spec.qtyStep) : 0;
    // The other levels keep the shares they show now; only this one changes.
    set({ levels: s.levels.map((l, i) => ({ ...l, frac: (i === index ? typed : view.levels[i].qty) / units })) });
    logFieldChange(`level${index + 1}Qty`, text);
  },
  pruneLevels: (view) => {
    const s = get();
    const keep = s.levels.filter((_, i) => (view.levels[i]?.qty ?? 1) > 0);
    if (keep.length === s.levels.length && keep.length >= 2) return;
    if (keep.length >= 2) return set({ levels: keep });
    // One level (or none) left: back to the SL / TP fields with that level's values.
    const only = keep[0];
    const leg = (kind: ExitKind): ExitState => ({ enabled: !!only && only[kind].input.trim() !== '', unit: only ? only[kind].unit : s[kind].unit, input: only ? only[kind].input : '', touched: true });
    set({ levels: [], ...(only ? { tp: leg('tp'), sl: leg('sl') } : {}) });
  },
  setLevelLeg: (index, kind, text) => {
    set((s) => ({ levels: s.levels.map((l, i) => (i === index ? { ...l, [kind]: { ...l[kind], input: text } } : l)) }));
    logFieldChange(`level${index + 1}${kind}`, text);
  },
  setLevelLegUnit: (index, kind, unit, view) => {
    const s = get();
    const l = s.levels[index];
    if (!l || l[kind].unit === unit) return;
    const lvl = view.levels[index]?.[kind].level;
    const text = lvl && !lvl.invalid ? exitInputText(lvl, unit, getSpec(s.symbol)) : '';
    set({ levels: s.levels.map((x, i) => (i === index ? { ...x, [kind]: { unit, input: text } } : x)) });
    logEvent('unit_change', { field: `level${index + 1}${kind}`, unit });
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
      // The same for the stop losses of the levels.
      if (s.levels.some((l) => l.sl.unit === 'money' || l.sl.unit === 'balancePercent')) {
        set({
          levels: s.levels.map((l, i) => {
            if (l.sl.unit !== 'money' && l.sl.unit !== 'balancePercent') return l;
            const lvl = view.levels[i]?.sl.level;
            return { ...l, sl: { unit: 'price', input: lvl && !lvl.invalid ? exitInputText(lvl, 'price', spec) : '' } };
          }),
        });
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
  clearQty: () => set({ qtyInput: '', levels: [] }),
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
