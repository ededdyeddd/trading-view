/**
 * deriveTicket — pure function from raw ticket input + market + account to everything
 * an order panel renders and submits. Both panel variants (current / new) read only this.
 */
import { pricePrecision, type SymbolSpec } from '../config/symbols';
import { computeExpiry } from '../engine/paperEngine';
import type { ExitLevelDraft, OrderDraft } from '../engine/types';
import { fmtQty, parseNum, priceInput as fmtPriceInput } from '../lib/format';
import {
  checkPrice,
  defaultExitPrice,
  defaultOrderPrice,
  describeExit,
  exceedsMargin,
  exitsSummary,
  exitDirection,
  marginFor,
  marketRef,
  maxQtyForMargin,
  moneyPerPoint,
  offsetDirection,
  offsetTicks,
  priceFromOffset,
  qtyEquivalents,
  resolveExit,
  resolveQty,
  riskPerUnit,
  riskReward,
  scaleLevels,
  sortLevelIndices,
  roundToTick,
  tickValue,
  tradeValue,
  exitValueInUnit,
  type ExitKind,
  type ExitLevel,
  type ExitUnit,
  type ExitsLevel,
} from '../lib/orderMath';
import type { Quote } from '../market/types';
import type { DisabledReason, ExitState, ExitView, LevelLegView, LevelView, QtyView, TicketState, TicketView } from './types';

/** Production defaults: TP 75 ticks, SL 25 ticks from entry. */
export const DEFAULT_EXIT_TICKS: Record<ExitKind, number> = { tp: 75, sl: 25 };

/** Redesign defaults of a level: SL 2% and TP 4% from entry (the placeholder, and what switching it on fills). */
export const NEW_EXIT_DEFAULT_PERCENT: Record<ExitKind, number> = { sl: 2, tp: 4 };

/** Text a level has in an input unit: prices to tick precision, ticks as integers, the rest to 2 decimals. */
export function exitInputText(level: ExitLevel, unit: ExitUnit, spec: SymbolSpec): string {
  const v = exitValueInUnit(level, unit);
  if (unit === 'price') return v.toFixed(pricePrecision(spec));
  if (unit === 'ticks') return String(v);
  return v.toFixed(2);
}

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
    const unit = state.priceUnit ?? 'price';
    const value = priceValue(state, quote, spec);
    const check = value !== null && ready ? checkPrice(state.type, state.side, value, bid, ask) : { fillsNow: false, invalid: false };
    const ref = ready ? marketRef(state.side, bid, ask) : 0;
    const placeholder = ready ? defaultOrderPrice(state.type, state.side, bid, ask, spec.tickSize) : 0;
    price = {
      unit,
      value,
      placeholder,
      offset: value !== null && ready ? roundToTick(value - ref, spec.tickSize) : null,
      direction: offsetDirection(state.type, state.side) < 0 ? 'below' : 'above',
      offsetTicks: value !== null && ready ? offsetTicks(value, state.side, bid, ask, spec.tickSize) : null,
      ref: state.side === 'buy' ? 'Ask' : 'Bid',
      fillsNow: check.fillsNow,
      invalid: check.invalid,
      status: state.priceStatus,
    };
    entry = value;
  }

  // 2. Quantity (risk units need the stop-loss distance first) -----------------
  const qtyValue = parseNum(state.qtyInput);
  const riskSized = state.qtyUnit === 'riskMoney' || state.qtyUnit === 'riskBalancePercent';
  let slCircular = false;
  let slDistanceForQty: number | null = null;
  // Without a limit / stop price the exits (and the stop-loss distance behind a risk-sized quantity) count from the price placeholder.
  const placeholderEntry = entry ?? (price && price.placeholder > 0 ? price.placeholder : null);
  const sizingEntry = placeholderEntry;
  const multi = state.levels.length >= 2;
  // With several levels the risk distance is the share-weighted average over the levels that have a stop loss.
  const slLegs = multi ? state.levels.filter((l) => l.sl.input.trim() !== '') : state.sl.enabled ? [{ frac: 1, sl: state.sl }] : [];
  const slOn = slLegs.length > 0;
  if (riskSized && slOn && sizingEntry !== null) {
    let weighted = 0;
    let weights = 0;
    for (const l of slLegs) {
      if (MONEY_UNITS.includes(l.sl.unit)) {
        slCircular = true;
        continue;
      }
      const lvl = exitLevel('sl', { enabled: true, unit: l.sl.unit, input: l.sl.input, touched: true }, state, sizingEntry, 1, balance, spec);
      if (lvl && !lvl.invalid) {
        weighted += l.frac * lvl.distance;
        weights += l.frac;
      }
    }
    // The single stop loss may be untouched (production default); `exitLevel` handles it through ExitState.
    if (!multi && state.sl.enabled && !MONEY_UNITS.includes(state.sl.unit)) {
      const lvl = exitLevel('sl', state.sl, state, sizingEntry, 1, balance, spec);
      weighted = lvl && !lvl.invalid ? lvl.distance : 0;
      weights = lvl && !lvl.invalid ? 1 : 0;
    }
    slDistanceForQty = weights > 0 ? weighted / weights : null;
  }
  // Without a limit / stop price, quantity is valued at the suggested price (the price placeholder).
  const qtyPrice = entry ?? (price && price.placeholder > 0 ? price.placeholder : ready ? marketRef(state.side, bid, ask) : 0);
  const qtyRes =
    qtyPrice > 0
      ? resolveQty({ unit: state.qtyUnit, value: qtyValue, price: qtyPrice, balance, slDistance: slDistanceForQty, spec })
      : { qty: 0, needsStopLoss: riskSized && !slOn };
  const units = qtyRes.qty;

  // 3. Exits of the single level (the SL / TP fields) with the final quantity -----------------------------
  const sl = exitView('sl', state.sl, state, entry, units, balance, spec, slCircular && !multi, placeholderEntry);
  const tp = exitView('tp', state.tp, state, entry, units, balance, spec, false, placeholderEntry);
  const slDistance = sl.level && !sl.level.invalid ? sl.level.distance : null;

  const eq = qtyEquivalents(units, qtyPrice, balance, slDistance, spec);
  const perUnit = slDistance !== null && entry !== null && sl.level ? riskPerUnit(entry, sl.level.price, spec) : null;
  const qty = {
    units,
    needsStopLoss: qtyRes.needsStopLoss || (riskSized && (!slOn || slCircular)),
    equivalents: eq,
    tradeValue: tradeValue(units, qtyPrice, spec),
    margin: marginFor(units, qtyPrice, spec),
    tickValue: tickValue(units, spec, qtyPrice),
    realRisk: eq.riskMoney,
    riskPerUnit: perUnit,
    riskBelowOne: riskSized && qtyValue > 0 && units === 0 && slDistanceForQty !== null,
    maxUnits: qtyPrice > 0 ? maxQtyForMargin(ctx.availableFunds, qtyPrice, spec) : 0,
    placeholder: qtyPlaceholder(spec, qtyPrice, balance, slOn && !slCircular ? (multi ? slDistanceForQty : slDistance) : null),
  };

  // 3b. Levels (2+): every level is valued at its own shares, priced from the entry (or the price placeholder).
  const levelEntry = placeholderEntry;
  const levelQtys = multi ? scaleLevels(state.levels.map((l) => l.frac), units, spec.qtyStep) : [];
  const levels: LevelView[] = state.levels.map((l, i) => {
    const qty = levelQtys[i];
    const leg = (kind: ExitKind): LevelLegView => {
      const x = l[kind];
      if (x.input.trim() === '' || levelEntry === null) return { level: null, error: null };
      const level = exitLevel(kind, { enabled: true, unit: x.unit, input: x.input, touched: true }, state, levelEntry, qty > 0 ? qty : 1, balance, spec);
      if (!level) return { level: null, error: kind === 'sl' ? 'Enter stop loss' : 'Enter take profit' };
      return { level, error: level.invalid ? wrongSideText(kind, state.side) : null };
    };
    return { qty, percent: units > 0 ? (qty / units) * 100 : 0, tp: leg('tp'), sl: leg('sl') };
  });
  const validPrice = (v: { level: ExitLevel | null }) => (v.level && !v.level.invalid ? v.level.price : null);
  const levelOrder = sortLevelIndices(state.side, levels.map((v) => validPrice(v.tp)));
  const protectedQty = multi ? Number(levelQtys.reduce((a, q) => a + q, 0).toFixed(10)) : units;
  const protectedPercent = units > 0 ? (protectedQty / units) * 100 : 0;
  // Problems in the exits, in the order the rows are shown: the first wrong side, else too many shares.
  const unit = spec.qtyLabel.toLowerCase();
  const over = Number((protectedQty - units).toFixed(10));
  let exitsError: string | null = null;
  let exitsCaption: string | null = null;
  if (multi) {
    for (const i of levelOrder) exitsError ??= levels[i].sl.error ?? levels[i].tp.error;
    if (over > 1e-9) {
      exitsCaption = `Exits exceed the order by ${fmtQty(over, spec)} ${unit}`;
      exitsError = `Reduce exits to ${fmtQty(units, spec)} ${unit}`;
    }
  }
  // Summary over all levels (one level = the single SL / TP).
  const summaryLevels: ExitsLevel[] = multi
    ? levels.map((v) => ({ qty: v.qty, tp: validPrice(v.tp), sl: validPrice(v.sl) }))
    : [{ qty: units, tp: tp.enabled && tp.level && !tp.level.invalid ? tp.level.price : null, sl: sl.enabled && sl.level && !sl.level.invalid ? sl.level.price : null }];
  const summary =
    levelEntry !== null && summaryLevels.some((l) => l.tp !== null || l.sl !== null) ? exitsSummary(state.side, levelEntry, units, summaryLevels, spec) : null;
  const slDistanceSingle = sl.level && !sl.level.invalid ? sl.level.distance : null;
  const rr =
    !multi && sl.enabled && tp.enabled && sl.level && !sl.level.invalid && tp.level && !tp.level.invalid && slDistanceSingle !== null
      ? riskReward(sl.level.distance, tp.level.distance)
      : null;

  // 4. Expiry and session -------------------------------------------------------
  const gtdMs = state.gtdDate ? new Date(`${state.gtdDate}T${state.gtdTime || '00:00'}:00`).getTime() : undefined;
  const expiresAt = state.type === 'market' ? null : computeExpiry(state.tif, now, gtdMs);
  const opensAt = ctx.opensAt ?? null;

  // 5. Submit gate --------------------------------------------------------------
  let reason: DisabledReason | null = null;
  const needPrice = state.type !== 'market' && price?.value === null;
  if (!ready) reason = 'no-quote';
  else if (qty.needsStopLoss) reason = 'set-stop-loss';
  else if (needPrice && !(units > 0) && !qty.riskBelowOne) reason = 'enter-price-and-quantity';
  else if (needPrice) reason = 'enter-price';
  else if (qty.riskBelowOne) reason = 'risk-below-one';
  else if (!(units > 0)) reason = 'enter-quantity';
  else if (units < spec.minQty) reason = 'below-min-qty';
  else if (price?.invalid && !rules.allowTriggeredStop) reason = 'invalid-price';
  else if (!multi && ((sl.enabled && (sl.error || !sl.level)) || (tp.enabled && (tp.error || !tp.level)))) reason = 'invalid-exit';
  else if (exitsError) reason = 'invalid-exit';
  else if (rules.blockOnMargin && exceedsMargin(qty.margin, ctx.availableFunds)) reason = 'not-enough-margin';

  const exitLevels: ExitLevelDraft[] | undefined = multi
    ? levels.map((v) => ({ qty: v.qty, takeProfit: validPrice(v.tp) ?? undefined, stopLoss: validPrice(v.sl) ?? undefined }))
    : undefined;
  const draft: OrderDraft | null =
    reason === null && entry !== null
      ? {
          symbol: spec.symbol,
          side: state.side,
          type: state.type,
          qty: units,
          limitPrice: state.type === 'limit' ? entry : undefined,
          stopPrice: state.type === 'stop' ? entry : undefined,
          stopLoss: exitLevels ? undefined : sl.enabled && sl.level ? sl.level.price : undefined,
          takeProfit: exitLevels ? undefined : tp.enabled && tp.level ? tp.level.price : undefined,
          exitLevels,
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
    levels,
    levelOrder,
    levelEntry,
    protectedQty,
    protectedPercent,
    summary,
    exitsError,
    exitsCaption,
    riskReward: rr,
    expiresAt,
    availableFunds: ctx.availableFunds,
    balance,
    marginExceeded: units > 0 && exceedsMargin(qty.margin, ctx.availableFunds),
    canSubmit: draft !== null,
    disabledReason: reason,
    disabledText: reason ? disabledText(reason, state, sl, tp, exitsError) : null,
    draft,
    opensAt,
  };
}

/** Limit / stop price the input stands for: an absolute price, or a signed price offset from Ask / Bid (0 = at the market). */
export function priceValue(state: TicketState, quote: Quote | undefined, spec: SymbolSpec): number | null {
  if (state.type === 'market') return null;
  const raw = parseNum(state.priceInput);
  if ((state.priceUnit ?? 'price') === 'offset') {
    if (!Number.isFinite(raw) || !quote) return null;
    const price = priceFromOffset(state.side, quote.bid, quote.ask, raw, spec.tickSize);
    return price > 0 ? price : null;
  }
  return raw > 0 ? roundToTick(raw, spec.tickSize) : null;
}

/** "Stop loss must be below entry price" */
function wrongSideText(kind: ExitKind, side: TicketState['side']): string {
  return `${kind === 'sl' ? 'Stop loss' : 'Take profit'} must be ${(kind === 'sl') === (side === 'buy') ? 'below' : 'above'} entry`;
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

/** Minimum quantity in every unit (risk at the stop-loss distance when there is one). */
function qtyPlaceholder(spec: SymbolSpec, price: number, balance: number, slDistance: number | null): QtyView['placeholder'] {
  if (!(price > 0)) return null;
  const value = tradeValue(spec.minQty, price, spec);
  const risk = slDistance !== null && slDistance > 0 ? slDistance * moneyPerPoint(spec.minQty, spec, price) : null;
  return {
    units: spec.minQty,
    value,
    balancePercent: balance > 0 ? (value / balance) * 100 : 0,
    riskMoney: risk,
    riskBalancePercent: risk !== null && balance > 0 ? (risk / balance) * 100 : null,
  };
}

/** Grey value of an empty or switched-off level: the last typed value, else the default from `entry`. */
function exitPlaceholder(
  kind: ExitKind,
  ex: ExitState,
  side: TicketState['side'],
  entry: number | null,
  qty: number,
  balance: number,
  spec: SymbolSpec,
): Pick<ExitView, 'placeholder' | 'placeholderLevel'> {
  if (entry === null) return { placeholder: '', placeholderLevel: null };
  const needsQty = MONEY_UNITS.includes(ex.unit) && !(qty > 0);
  if (ex.input.trim() !== '') {
    const value = parseNum(ex.input);
    const level = Number.isFinite(value) && !needsQty ? resolveExit({ kind, side, entry, qty: qty > 0 ? qty : 1, unit: ex.unit, value, balance, spec }) : null;
    return { placeholder: ex.input, placeholderLevel: level };
  }
  if (needsQty) return { placeholder: '', placeholderLevel: null };
  const price = defaultExitPrice(kind, side, entry, NEW_EXIT_DEFAULT_PERCENT[kind], spec.tickSize);
  const level = describeExit(kind, side, entry, qty > 0 ? qty : 1, price, balance, spec);
  return { placeholder: exitInputText(level, ex.unit, spec), placeholderLevel: level };
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
  placeholderEntry: number | null,
): ExitView {
  const ph = exitPlaceholder(kind, ex, state.side, placeholderEntry, qty, balance, spec);
  if (entry === null) return { enabled: ex.enabled, unit: ex.unit, input: ex.input, level: null, error: null, ...ph };
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
  return { enabled: ex.enabled, unit: ex.unit, input, level: qty > 0 || !MONEY_UNITS.includes(ex.unit) ? level : null, error, ...ph };
}

function disabledText(reason: DisabledReason, state: TicketState, sl: ExitView, tp: ExitView, exitsError: string | null): string {
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
      return exitsError ?? sl.error ?? tp.error ?? 'Check exits';
    case 'risk-below-one':
      return 'Risk too small for 1 share';
    case 'not-enough-margin':
      return 'Not enough margin';
  }
}
