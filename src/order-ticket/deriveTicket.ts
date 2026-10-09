/**
 * deriveTicket — pure function from raw ticket input + market + account to everything
 * an order panel renders and submits. Both panel variants (current / new) read only this.
 */
import type { SymbolSpec } from '../config/symbols';
import { computeExpiry } from '../engine/paperEngine';
import type { OrderDraft } from '../engine/types';
import { parseNum, priceInput as fmtPriceInput } from '../lib/format';
import {
  checkPrice,
  describeExit,
  exitDirection,
  marginFor,
  marketRef,
  offsetTicks,
  qtyEquivalents,
  resolveExit,
  resolveQty,
  riskReward,
  roundToTick,
  tickValue,
  tradeValue,
  type ExitKind,
  type ExitLevel,
  type ExitUnit,
} from '../lib/orderMath';
import type { Quote } from '../market/types';
import type { DisabledReason, ExitState, ExitView, TicketState, TicketView } from './types';

/** Production defaults: TP 75 ticks, SL 25 ticks from entry. */
export const DEFAULT_EXIT_TICKS: Record<ExitKind, number> = { tp: 75, sl: 25 };

export type TicketContext = {
  quote: Quote | undefined;
  spec: SymbolSpec;
  /** Account balance used for "% balance" units. */
  balance: number;
  availableFunds: number;
  now: number;
};

const MONEY_UNITS: ExitUnit[] = ['money', 'balancePercent'];

export function deriveTicket(state: TicketState, ctx: TicketContext): TicketView {
  const { quote, spec, balance, now } = ctx;
  const bid = quote?.bid ?? 0;
  const ask = quote?.ask ?? 0;
  const ready = !!quote;

  // 1. Entry -----------------------------------------------------------------
  let price: TicketView['price'] = null;
  let entry: number | null = null;
  if (state.type === 'market') {
    entry = ready ? marketRef(state.side, bid, ask) : null;
  } else {
    const raw = parseNum(state.priceInput);
    const value = raw > 0 ? roundToTick(raw, spec.tickSize) : null;
    const check = value !== null && ready ? checkPrice(state.type, state.side, value, bid, ask) : { fillsNow: false, invalid: false };
    price = {
      value,
      offsetTicks: value !== null && ready ? offsetTicks(value, state.side, bid, ask, spec.tickSize) : null,
      ref: state.side === 'buy' ? 'Ask' : 'Bid',
      fillsNow: check.fillsNow,
      invalid: check.invalid,
    };
    entry = value;
  }

  // 2. Quantity (risk units need the stop-loss distance first) -----------------
  const qtyValue = parseNum(state.qtyInput);
  const riskSized = state.qtyUnit === 'riskMoney' || state.qtyUnit === 'riskBalancePercent';
  let slCircular = false;
  let slDistanceForQty: number | null = null;
  if (riskSized && state.sl.enabled && entry !== null) {
    if (MONEY_UNITS.includes(state.sl.unit)) slCircular = true;
    else {
      const lvl = exitLevel('sl', state.sl, state, entry, 1, balance, spec);
      slDistanceForQty = lvl && !lvl.invalid ? lvl.distance : null;
    }
  }
  const qtyPrice = entry ?? (ready ? marketRef(state.side, bid, ask) : 0);
  const qtyRes =
    qtyPrice > 0
      ? resolveQty({ unit: state.qtyUnit, value: qtyValue, price: qtyPrice, balance, slDistance: slDistanceForQty, spec })
      : { qty: 0, needsStopLoss: riskSized && !state.sl.enabled };
  const units = qtyRes.qty;

  // 3. Exits with the final quantity -------------------------------------------
  const sl = exitView('sl', state.sl, state, entry, units, balance, spec, slCircular);
  const tp = exitView('tp', state.tp, state, entry, units, balance, spec, false);
  const slDistance = sl.level && !sl.level.invalid ? sl.level.distance : null;

  const eq = qtyEquivalents(units, qtyPrice, balance, slDistance, spec);
  const qty = {
    units,
    needsStopLoss: qtyRes.needsStopLoss || (riskSized && (!state.sl.enabled || slCircular)),
    equivalents: eq,
    tradeValue: tradeValue(units, qtyPrice, spec),
    margin: marginFor(units, qtyPrice, spec),
    tickValue: tickValue(units, spec, qtyPrice),
    realRisk: eq.riskMoney,
  };

  const rr =
    sl.enabled && tp.enabled && sl.level && tp.level && !sl.level.invalid && !tp.level.invalid ? riskReward(sl.level.distance, tp.level.distance) : null;

  // 4. Expiry -------------------------------------------------------------------
  const gtd = state.gtdDate ? new Date(`${state.gtdDate}T00:00:00`).getTime() : undefined;
  const expiresAt = state.type === 'market' ? null : computeExpiry(state.tif, now, gtd);

  // 5. Submit gate --------------------------------------------------------------
  let reason: DisabledReason | null = null;
  const needPrice = state.type !== 'market' && price?.value === null;
  if (!ready) reason = 'no-quote';
  else if (qty.needsStopLoss) reason = 'set-stop-loss';
  else if (needPrice && !(units > 0)) reason = 'enter-price-and-quantity';
  else if (needPrice) reason = 'enter-price';
  else if (!(units > 0)) reason = 'enter-quantity';
  else if (units < spec.minQty) reason = 'below-min-qty';
  else if (price?.invalid) reason = 'invalid-price';
  else if ((sl.enabled && (sl.error || !sl.level)) || (tp.enabled && (tp.error || !tp.level))) reason = 'invalid-exit';

  const draft: OrderDraft | null =
    reason === null && entry !== null
      ? {
          symbol: spec.symbol,
          side: state.side,
          type: state.type,
          qty: units,
          limitPrice: state.type === 'limit' ? entry : undefined,
          stopPrice: state.type === 'stop' ? entry : undefined,
          stopLoss: sl.enabled && sl.level ? sl.level.price : undefined,
          takeProfit: tp.enabled && tp.level ? tp.level.price : undefined,
          tif: state.tif,
          expiresAt: state.tif === 'gtd' ? (expiresAt ?? undefined) : undefined,
        }
      : null;

  return {
    ready,
    bid,
    ask,
    spread: ask - bid,
    entry,
    price,
    qty,
    sl,
    tp,
    riskReward: rr,
    expiresAt,
    availableFunds: ctx.availableFunds,
    canSubmit: draft !== null,
    disabledReason: reason,
    disabledText: reason ? disabledText(reason, state, sl, tp) : null,
    draft,
  };
}

function exitLevel(kind: ExitKind, ex: ExitState, state: TicketState, entry: number, qty: number, balance: number, spec: SymbolSpec): ExitLevel | null {
  if (!ex.touched && ex.unit === 'price') {
    // Untouched price exits follow the entry at the default offset.
    const px = roundToTick(entry + exitDirection(kind, state.side) * DEFAULT_EXIT_TICKS[kind] * spec.tickSize, spec.tickSize);
    return describeExit(kind, state.side, entry, qty, px, balance, spec);
  }
  const value = parseNum(ex.input);
  if (!Number.isFinite(value)) return null;
  return resolveExit({ kind, side: state.side, entry, qty, unit: ex.unit, value, balance, spec });
}

function exitView(
  kind: ExitKind,
  ex: ExitState,
  state: TicketState,
  entry: number | null,
  qty: number,
  balance: number,
  spec: SymbolSpec,
  circular: boolean,
): ExitView {
  if (entry === null) return { enabled: ex.enabled, unit: ex.unit, input: ex.input, level: null, error: null };
  // Money units need a quantity; with zero quantity show the level for 1 unit so the field is not blank.
  const level = exitLevel(kind, ex, state, entry, qty > 0 ? qty : 1, balance, spec);
  const input = !ex.touched && ex.unit === 'price' && level ? fmtPriceInput(level.price, spec) : ex.input;
  let error: string | null = null;
  if (ex.enabled) {
    if (circular) error = 'Use price, ticks or % for stop loss when sizing by risk';
    else if (!level) error = kind === 'sl' ? 'Enter stop loss' : 'Enter take profit';
    else if (level.invalid)
      error = `${kind === 'sl' ? 'Stop loss' : 'Take profit'} must be ${(kind === 'sl') === (state.side === 'buy') ? 'below' : 'above'} entry price`;
  }
  return { enabled: ex.enabled, unit: ex.unit, input, level: qty > 0 || !MONEY_UNITS.includes(ex.unit) ? level : null, error };
}

function disabledText(reason: DisabledReason, state: TicketState, sl: ExitView, tp: ExitView): string {
  const verb = state.side === 'buy' ? 'buy' : 'sell';
  switch (reason) {
    case 'no-quote':
      return 'Waiting for market data';
    case 'enter-quantity':
      return `Enter quantity to ${verb} ${state.symbol}`;
    case 'enter-price':
      return 'Enter price';
    case 'enter-price-and-quantity':
      return 'Enter price and quantity';
    case 'set-stop-loss':
      return 'Set stop loss to calculate size';
    case 'below-min-qty':
      return 'Quantity is below the minimum';
    case 'invalid-price':
      return "Selected price isn't valid for this order type";
    case 'invalid-exit':
      return sl.error ?? tp.error ?? 'Check exits';
  }
}
