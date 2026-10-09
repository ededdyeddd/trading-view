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
  defaultLevelPercents,
  describeExit,
  exceedsMargin,
  exitDirection,
  marginFor,
  marketRef,
  maxQtyForMargin,
  offsetDirection,
  offsetTicks,
  priceFromOffset,
  qtyEquivalents,
  resolveExit,
  resolveQty,
  riskPerUnit,
  riskReward,
  roundToTick,
  splitQty,
  tickValue,
  tradeValue,
  weightedAverage,
  type ExitKind,
  type ExitLevel,
  type ExitUnit,
} from '../lib/orderMath';
import type { Quote } from '../market/types';
import type { DisabledReason, ExitState, ExitView, TicketState, TicketView, TpLevelView } from './types';

/** Production defaults: TP 75 ticks, SL 25 ticks from entry. */
export const DEFAULT_EXIT_TICKS: Record<ExitKind, number> = { tp: 75, sl: 25 };

/** Rules that differ between the production control and the redesign. */
export type TicketRules = {
  /** Block submit when margin is insufficient (production submits and the engine rejects). */
  blockOnMargin: boolean;
  /** A stop already beyond the market is a warning ("Triggers now"), not a block (production blocks). */
  allowTriggeredStop: boolean;
};

export const CURRENT_RULES: TicketRules = { blockOnMargin: false, allowTriggeredStop: false };
export const NEW_RULES: TicketRules = { blockOnMargin: true, allowTriggeredStop: true };

export type TicketContext = {
  quote: Quote | undefined;
  spec: SymbolSpec;
  /** Account balance used for "% balance" units. */
  balance: number;
  availableFunds: number;
  now: number;
  rules?: TicketRules;
  /** When the session is closed: the next open (ms). Market orders are queued until then. */
  opensAt?: number | null;
};

const MONEY_UNITS: ExitUnit[] = ['money', 'balancePercent'];

export function deriveTicket(state: TicketState, ctx: TicketContext): TicketView {
  const { quote, spec, balance, now } = ctx;
  const rules = ctx.rules ?? CURRENT_RULES;
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
    const unit = state.priceUnit ?? 'price';
    let value: number | null = null;
    if (unit === 'ticks') value = raw > 0 && ready ? priceFromOffset(state.type, state.side, bid, ask, raw, spec.tickSize) : null;
    else value = raw > 0 ? roundToTick(raw, spec.tickSize) : null;
    const check = value !== null && ready ? checkPrice(state.type, state.side, value, bid, ask) : { fillsNow: false, invalid: false };
    const ref = ready ? marketRef(state.side, bid, ask) : 0;
    price = {
      unit,
      value,
      placeholder: ref,
      offset: value !== null && ready ? roundToTick(value - ref, spec.tickSize) : null,
      direction: offsetDirection(state.type, state.side) < 0 ? 'below' : 'above',
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
  const perUnit = slDistance !== null && entry !== null && sl.level ? riskPerUnit(entry, sl.level.price, spec) : null;
  const qty = {
    units,
    needsStopLoss: qtyRes.needsStopLoss || (riskSized && (!state.sl.enabled || slCircular)),
    equivalents: eq,
    tradeValue: tradeValue(units, qtyPrice, spec),
    margin: marginFor(units, qtyPrice, spec),
    tickValue: tickValue(units, spec, qtyPrice),
    realRisk: eq.riskMoney,
    riskPerUnit: perUnit,
    riskBelowOne: riskSized && qtyValue > 0 && units === 0 && slDistanceForQty !== null,
    maxUnits: qtyPrice > 0 ? maxQtyForMargin(ctx.availableFunds, qtyPrice, spec) : 0,
  };

  // 3b. Take-profit levels (TP 1 + up to two extra) ------------------------------
  const levelCount = 1 + state.tpLevels.length;
  const defaults = defaultLevelPercents(levelCount);
  const percents = [state.tpPercent, ...state.tpLevels.map((l) => l.percent)].map((p, i) => {
    if (levelCount === 1) return 100;
    const n = parseNum(p);
    return Number.isFinite(n) ? n : defaults[i];
  });
  const levelQty = splitQty(units, percents, spec.qtyStep);
  const tpLevels: TpLevelView[] = [{ input: tp.input, level: tp.level, percent: percents[0], qty: levelQty[0], money: null, error: tp.error }];
  state.tpLevels.forEach((l, i) => {
    const v = exitView(
      'tp',
      { enabled: state.tp.enabled, unit: state.tp.unit, input: l.input, touched: true },
      state,
      entry,
      levelQty[i + 1] || units,
      balance,
      spec,
      false,
    );
    tpLevels.push({ input: l.input, level: v.level, percent: percents[i + 1], qty: levelQty[i + 1], money: null, error: v.error });
  });
  // Money of each level uses its own quantity.
  const tpMoneyParts = tpLevels.map((l) =>
    l.level && !l.level.invalid && entry !== null
      ? describeExit('tp', state.side, entry, levelCount === 1 ? units : l.qty, l.level.price, balance, spec).money
      : null,
  );
  tpMoneyParts.forEach((m, i) => (tpLevels[i].money = m));
  const tpValid = tp.enabled && tpMoneyParts.every((m) => m !== null);
  const tpMoney = tpValid ? Math.round(tpMoneyParts.reduce<number>((a, m) => a + (m ?? 0), 0) * 100) / 100 : null;
  const tpPercentLeft = Math.max(0, 100 - percents.reduce((a, b) => a + b, 0));
  const avgTpDistance =
    tpValid && entry !== null
      ? weightedAverage(
          tpLevels.map((l) => l.level!.distance),
          levelCount === 1 ? [1] : tpLevels.map((l) => l.percent),
        )
      : null;

  const rr = sl.enabled && tp.enabled && sl.level && !sl.level.invalid && avgTpDistance !== null ? riskReward(sl.level.distance, avgTpDistance) : null;

  // 4. Expiry and session -------------------------------------------------------
  const gtdMs = state.gtdDate ? new Date(`${state.gtdDate}T${state.gtdTime || '00:00'}:00`).getTime() : undefined;
  const expiresAt = state.type === 'market' ? null : computeExpiry(state.tif, now, gtdMs);
  const opensAt = ctx.opensAt ?? null;

  // 5. Submit gate --------------------------------------------------------------
  let reason: DisabledReason | null = null;
  const needPrice = state.type !== 'market' && price?.value === null;
  const levelsInvalid = tp.enabled && tpLevels.slice(1).some((l) => !l.level || l.level.invalid || !(l.qty > 0));
  if (!ready) reason = 'no-quote';
  else if (qty.needsStopLoss) reason = 'set-stop-loss';
  else if (needPrice && !(units > 0) && !qty.riskBelowOne) reason = 'enter-price-and-quantity';
  else if (needPrice) reason = 'enter-price';
  else if (qty.riskBelowOne) reason = 'risk-below-one';
  else if (!(units > 0)) reason = 'enter-quantity';
  else if (units < spec.minQty) reason = 'below-min-qty';
  else if (price?.invalid && !rules.allowTriggeredStop) reason = 'invalid-price';
  else if ((sl.enabled && (sl.error || !sl.level)) || (tp.enabled && (tp.error || !tp.level)) || levelsInvalid) reason = 'invalid-exit';
  else if (rules.blockOnMargin && exceedsMargin(qty.margin, ctx.availableFunds)) reason = 'not-enough-margin';

  const tpLegs = tp.enabled && levelCount > 1 ? tpLevels.filter((l) => l.qty > 0 && l.level).map((l) => ({ price: l.level!.price, qty: l.qty })) : undefined;
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
          takeProfit: tp.enabled && tp.level && !tpLegs ? tp.level.price : undefined,
          takeProfits: tpLegs,
          tif: state.tif,
          expiresAt: state.tif === 'gtd' ? (expiresAt ?? undefined) : undefined,
          activateAt: state.type === 'market' && opensAt !== null ? opensAt : undefined,
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
    tpLevels,
    tpMoney,
    tpPercentLeft,
    riskReward: rr,
    expiresAt,
    availableFunds: ctx.availableFunds,
    marginExceeded: units > 0 && exceedsMargin(qty.margin, ctx.availableFunds),
    canSubmit: draft !== null,
    disabledReason: reason,
    disabledText: reason ? disabledText(reason, state, sl, tp) : null,
    draft,
    opensAt,
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
    case 'risk-below-one':
      return 'Risk is below 1 share';
    case 'not-enough-margin':
      return 'Not enough margin';
  }
}
