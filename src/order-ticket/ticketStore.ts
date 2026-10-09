import { useMemo } from 'react';
import { create } from 'zustand';
import { logEvent, logFieldChange } from '../analytics/eventLog';
import { getSpec, qtyPrecision, type SymbolSpec } from '../config/symbols';
import type { TimeInForce } from '../engine/types';
import { priceInput } from '../lib/format';
import { marketRef, type ExitKind, type ExitUnit, type OrderType, type QtyUnit, type Side } from '../lib/orderMath';
import { useMarketStore } from '../market/marketStore';
import { now, useAccountSummary, useTradingStore } from '../store/tradingStore';
import { uiEvents, useUiStore } from '../store/uiStore';
import { deriveTicket } from './deriveTicket';
import type { ExitState, TicketState, TicketView } from './types';

function defaultQty(spec: SymbolSpec): string {
  if (spec.assetClass === 'crypto') return spec.symbol.startsWith('BTC') ? '0.01' : '0.1';
  if (spec.assetClass === 'forex') return '10000';
  return '1';
}

function initialState(symbol: string): TicketState {
  return {
    symbol,
    side: 'buy',
    type: 'limit',
    priceInput: '',
    qtyUnit: 'units',
    qtyInput: defaultQty(getSpec(symbol)),
    tp: { enabled: false, unit: 'price', input: '', touched: false },
    sl: { enabled: false, unit: 'ticks', input: '25', touched: true },
    tif: 'week',
    gtdDate: '',
    fillOutsideRth: false,
  };
}

type Actions = {
  /** Re-targets the ticket to another symbol (keeps side, type and units; resets price). */
  setSymbol: (symbol: string) => void;
  setSide: (side: Side) => void;
  setType: (type: OrderType) => void;
  setPriceInput: (text: string) => void;
  /** Fills an empty price with the current market reference (Ask for buy, Bid for sell). */
  ensurePrice: () => void;
  setQtyInput: (text: string) => void;
  setQtyUnit: (unit: QtyUnit, view: TicketView) => void;
  setExitEnabled: (kind: ExitKind, enabled: boolean) => void;
  setExitInput: (kind: ExitKind, text: string) => void;
  setExitUnit: (kind: ExitKind, unit: ExitUnit, view: TicketView) => void;
  setTif: (tif: TimeInForce) => void;
  setGtdDate: (date: string) => void;
  setFillOutsideRth: (v: boolean) => void;
  /** Submits the derived draft to the paper engine. */
  submit: (view: TicketView) => boolean;
};

export const useTicketStore = create<TicketState & Actions>((set, get) => ({
  ...initialState(useUiStore.getState().symbol),

  setSymbol: (symbol) => {
    if (symbol === get().symbol) return;
    const spec = getSpec(symbol);
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
    get().ensurePrice();
    logEvent('type_change', { type });
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
  setExitEnabled: (kind, enabled) => {
    set((s) => ({ [kind]: { ...s[kind], enabled } }) as Partial<TicketState>);
    logEvent('toggle_change', { field: kind, enabled });
  },
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
    let text = '';
    if (lvl && !lvl.invalid) {
      if (unit === 'price') text = priceInput(lvl.price, spec);
      else if (unit === 'ticks') text = String(lvl.ticks);
      else if (unit === 'percent') text = lvl.percent.toFixed(2);
      else if (unit === 'money') text = Math.abs(lvl.money).toFixed(2);
      else text = lvl.balancePercent.toFixed(2);
    }
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
  submit: (view) => {
    if (!view.draft) return false;
    logEvent('submit', { draft: view.draft });
    const events = useTradingStore.getState().placeOrder(view.draft);
    const rejected = events.find((e) => e.type === 'rejected');
    logEvent('submit_result', { result: rejected ? 'rejected' : 'accepted', message: rejected?.message, orderId: events[0]?.order?.id });
    return !rejected;
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
  const quote = useMarketStore((s) => s.quotes[state.symbol]);
  const account = useAccountSummary();
  const spec = getSpec(state.symbol);
  const view = useMemo(
    () => deriveTicket(state, { quote, spec, balance: account.balance, availableFunds: account.availableFunds, now: now() }),
    [state, quote, spec, account.balance, account.availableFunds],
  );
  return { state, view, spec, quote, account };
}

export type OrderTicket = ReturnType<typeof useOrderTicket>;
