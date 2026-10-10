/**
 * Text presenters for the redesigned ticket: turn TicketView numbers into the exact strings of the
 * Figma / PRD tables (left value · right value · caption). No math here — numbers come from orderMath via deriveTicket.
 */
import { pricePrecision, qtyPrecision, type SymbolSpec } from '../../config/symbols';
import { computeExpiry } from '../../engine/paperEngine';
import type { TimeInForce } from '../../engine/types';
import { sessionCloseTime } from '../../market/session';
import { fmtMoney, fmtNumber, fmtPrice, fmtQty, offsetInput, parseNum } from '../../lib/format';
import { ceilTo, convertRisk, defaultRiskInput, marketRef, type ExitKind, type ExitLevel, type ExitUnit, type OrderType, type QtyUnit, type Side } from '../../lib/orderMath';
import type { Quote } from '../../market/types';
import type { PriceUnit, TicketState, TicketView } from '../../order-ticket/types';

/** `muted` = grey: the right value of an empty or switched-off field. */
export type Tone = 'neutral' | 'danger' | 'success' | 'warning' | 'muted';
export type CaptionTone = 'neutral' | 'error' | 'warning';

export type FieldText = {
  /** Text right after the typed value. Units live in the field label, so only the tick direction ("below") uses it. */
  suffix: string;
  /** Second value on the right side of the field. */
  right: string;
  rightTone: Tone;
  caption: string | null;
  captionTone: CaptionTone;
};

const MINUS = '−';
/** A menu value that cannot be computed. */
export const DASH = '—';

export function signed(n: number, digits: number): string {
  return fmtNumber(n, digits, { sign: true });
}

export function signedMoney(n: number): string {
  return `${fmtMoney(n, { sign: true })} USD`;
}

function sharesWord(spec: SymbolSpec): string {
  return spec.qtyLabel.toLowerCase();
}

/** "1 share", "100 shares". */
export function unitsText(qty: number, spec: SymbolSpec): string {
  const word = sharesWord(spec);
  return `${fmtQty(qty, spec)} ${qty === 1 ? word.replace(/s$/, '') : word}`;
}

function pct(n: number): string {
  return `${fmtNumber(n, 2)}%`;
}

function decimalsTyped(raw: string): number {
  const i = raw.indexOf('.');
  return i < 0 ? 0 : raw.length - i - 1;
}

function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Limit / Stop price
// ---------------------------------------------------------------------------

/** Field label: "Limit price" / "Stop price", or "Offset from Ask" / "Offset from Bid" in offset mode. */
export function priceLabel(type: OrderType, unit: PriceUnit = 'price', side: Side = 'buy'): string {
  if (unit === 'offset') return `Offset from ${side === 'buy' ? 'Ask' : 'Bid'}`;
  return type === 'stop' ? 'Stop price' : 'Limit price';
}

/** Tooltip of the ⇆ in the price field: what a click switches to. */
export function priceSwapLabel(unit: PriceUnit, side: Side): string {
  return unit === 'price' ? `Enter as offset from ${side === 'buy' ? 'Ask' : 'Bid'}` : 'Enter as price';
}

/** "Ask − 2.57", "Bid + 3.44", "Ask" when equal (`offset` defaults to the entered price's). */
export function offsetText(view: TicketView, spec: SymbolSpec, offset = view.price?.offset ?? null): string {
  const p = view.price;
  if (!p || offset === null) return '';
  if (offset === 0) return p.ref;
  return `${p.ref} ${offset > 0 ? '+' : MINUS} ${fmtPrice(Math.abs(offset), spec)}`;
}

/**
 * Warning when the order would execute at once. Follows the status from the last commit (not the live market), so it does
 * not flicker with ticks. Not a block.
 */
export function priceWarning(side: Side, view: TicketView): string | null {
  const p = view.price;
  if (!p || p.value === null || p.status === 'ok') return null;
  if (p.status === 'fillsNow') return side === 'buy' ? 'Fills now: price is above Ask' : 'Fills now: price is below Bid';
  return side === 'buy' ? 'Triggers now: price is below Ask' : 'Triggers now: price is above Bid';
}

/**
 * `placeholder` = the suggested price in grey (Limit 1% / Stop 1.5% away from Ask / Bid; in offset mode its offset);
 * `fill` = what a click into the empty field substitutes.
 */
export function priceText(
  state: TicketState,
  view: TicketView,
  spec: SymbolSpec,
  /** Quote for the "Ask − 2.57" label, refreshed at most once a second (defaults to the view's). */
  labelQuote?: Pick<Quote, 'bid' | 'ask'>,
): FieldText & { placeholder: string; fill: string } {
  const p = view.price;
  const warning = priceWarning(state.side, view);
  // "Fills now" / "Triggers now" are shown as errors (red) although they do not block the button.
  const tone: Tone = warning ? 'danger' : 'neutral';
  if (!p) return { suffix: '', right: '', rightTone: 'neutral', caption: null, captionTone: 'neutral', placeholder: '', fill: '' };
  const ready = view.ready && p.placeholder > 0;
  const ref = state.side === 'buy' ? view.ask : view.bid;
  const phOffset = Number((p.placeholder - ref).toFixed(pricePrecision(spec)));
  const offsetMode = p.unit === 'offset';
  // Empty field: the right side explains the grey placeholder in the other mode ("Ask − 2.57" / its price).
  const empty = p.value === null && ready ? (offsetMode ? fmtPrice(p.placeholder, spec) : offsetText(view, spec, phOffset)) : null;
  const labelOffset =
    labelQuote && p.value !== null ? Number((p.value - marketRef(state.side, labelQuote.bid, labelQuote.ask)).toFixed(pricePrecision(spec))) : undefined;
  const phText = ready ? (offsetMode ? offsetInput(phOffset, spec) : fmtPrice(p.placeholder, spec, { grouping: false })) : '';
  return {
    suffix: '',
    right: empty ?? (offsetMode ? (p.value !== null ? fmtPrice(p.value, spec) : '') : offsetText(view, spec, labelOffset)),
    rightTone: empty ? 'muted' : tone,
    caption: warning,
    captionTone: warning ? 'error' : 'neutral',
    placeholder: phText,
    fill: phText,
  };
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

export const QTY_UNITS: QtyUnit[] = ['units', 'value', 'balancePercent', 'riskMoney', 'riskBalancePercent'];

export function isRiskUnit(unit: QtyUnit): unit is 'riskMoney' | 'riskBalancePercent' {
  return unit === 'riskMoney' || unit === 'riskBalancePercent';
}

export function qtyUnitLabel(unit: QtyUnit, spec: SymbolSpec): string {
  switch (unit) {
    case 'units':
      return spec.qtyLabel;
    case 'value':
      return 'USD';
    case 'balancePercent':
      return '% balance';
    case 'riskMoney':
      return 'Risk USD';
    case 'riskBalancePercent':
      return 'Risk % balance';
  }
}

function qtyValueText(unit: QtyUnit, n: number, spec: SymbolSpec): string {
  if (unit === 'units') return fmtQty(n, spec);
  if (unit === 'value' || unit === 'riskMoney') return fmtMoney(n);
  return pct(n);
}

/**
 * Live value of the order quantity in a unit, for the label menu (PRD "Меню единиц"). The selected unit shows what was
 * typed; the rest are recalculated from it. In risk modes the other risk unit converts the typed risk (the actual risk
 * after rounding shows only on the SL field and in the summary).
 */
export function qtyMenuValue(unit: QtyUnit, state: TicketState, view: TicketView, spec: SymbolSpec): string {
  if (isRiskUnit(unit) && (!state.sl.enabled || view.qty.needsStopLoss)) return 'Needs SL';
  const typed = parseNum(state.qtyInput);
  if (unit === state.qtyUnit && Number.isFinite(typed)) return qtyValueText(unit, typed, spec);
  if (isRiskUnit(unit) && isRiskUnit(state.qtyUnit) && Number.isFinite(typed)) return qtyValueText(unit, convertRisk(typed, unit, view.balance), spec);
  if (!(view.qty.units > 0)) return DASH;
  const eq = view.qty.equivalents;
  const n = { units: eq.units, value: eq.value, balancePercent: eq.balancePercent, riskMoney: eq.riskMoney, riskBalancePercent: eq.riskBalancePercent }[unit];
  return n === null ? DASH : qtyValueText(unit, n, spec);
}

/** ⓘ text of a quantity menu item (none for Shares). */
export function qtyUnitInfo(unit: QtyUnit, spec: SymbolSpec): string | undefined {
  switch (unit) {
    case 'units':
      return undefined;
    case 'value':
      return `${spec.qtyLabel} × entry price`;
    case 'balancePercent':
      return 'Position value as % of balance';
    case 'riskMoney':
      return `${spec.qtyLabel} × distance to SL`;
    case 'riskBalancePercent':
      return 'Risk as % of balance';
  }
}

/**
 * Grey placeholder of an empty quantity field: the symbol's minimum quantity in the current unit (AAPL: 1 share ·
 * 201.57 USD). `fill` is what a click substitutes — rounded up to the cent so it still buys the minimum.
 */
export function qtyPlaceholder(state: TicketState, view: TicketView, spec: SymbolSpec): { placeholder: string; fill: string; right: string } {
  const ph = view.qty.placeholder;
  const none = { placeholder: '0', fill: '', right: '' };
  if (!ph) return none;
  const minUnits = unitsText(ph.units, spec);
  switch (state.qtyUnit) {
    case 'units':
      return { placeholder: fmtQty(ph.units, spec), fill: ph.units.toFixed(qtyPrecision(spec)), right: `${fmtMoney(ph.value)} USD` };
    case 'value':
      return { placeholder: fmtMoney(ph.value), fill: ceilTo(ph.value, 2).toFixed(2), right: minUnits };
    case 'balancePercent':
      return { placeholder: fmtNumber(ph.balancePercent, 2), fill: ceilTo(ph.balancePercent, 2).toFixed(2), right: minUnits };
    case 'riskMoney':
    case 'riskBalancePercent': {
      // The default risk, 1% of balance; the shares it buys need a stop loss.
      const fill = defaultRiskInput(state.qtyUnit, view.balance);
      return { placeholder: formatQtyInput(fill, state.qtyUnit, spec), fill, right: '' };
    }
  }
}

/** "Risk too small for 1 share (min 4.07 USD)": the risk of one unit at the current stop loss. */
export function riskTooSmallText(riskPerUnit: number, spec: SymbolSpec): string {
  return `Risk too small for 1 ${sharesWord(spec).replace(/s$/, '')} (min ${fmtMoney(riskPerUnit)} USD)`;
}

export function qtyText(state: TicketState, view: TicketView, spec: SymbolSpec): FieldText {
  const units = view.qty.units;
  const risk = isRiskUnit(state.qtyUnit);
  // The unit is in the field label ("Risk USD ▾"), so the value has no suffix.
  const suffix = '';
  const shares = unitsText(units, spec);
  if (risk && view.qty.needsStopLoss) {
    return { suffix, right: '—', rightTone: 'neutral', caption: null, captionTone: 'neutral' };
  }
  if (risk && view.qty.riskBelowOne && view.qty.riskPerUnit !== null) {
    return { suffix, right: shares, rightTone: 'neutral', caption: riskTooSmallText(view.qty.riskPerUnit, spec), captionTone: 'error' };
  }
  const availableMargin = `Available margin ${fmtMoney(view.availableFunds)} USD`;
  if (state.qtyInput.trim() === '') {
    return { suffix, right: qtyPlaceholder(state, view, spec).right, rightTone: 'muted', caption: availableMargin, captionTone: 'neutral' };
  }
  const right = state.qtyUnit === 'units' ? `${fmtMoney(view.qty.tradeValue)} USD` : shares;
  if (units > 0 && view.marginExceeded) {
    return {
      suffix,
      right,
      rightTone: 'neutral',
      caption: `Not enough margin for ${unitsText(units, spec)} · max ${fmtQty(view.qty.maxUnits, spec)}`,
      captionTone: 'error',
    };
  }
  if (units > 0) {
    return {
      suffix,
      right,
      rightTone: 'neutral',
      caption: `Margin ${fmtMoney(view.qty.margin)} USD · ${spec.pipSize ? 'Pip' : 'Tick'} ${fmtMoney(view.qty.tickValue)} USD`,
      captionTone: 'neutral',
    };
  }
  return { suffix, right, rightTone: 'neutral', caption: availableMargin, captionTone: 'neutral' };
}

/** How the typed quantity reads when the field is not focused ("20,000.00", "100"). */
export function formatQtyInput(raw: string, unit: QtyUnit, spec: SymbolSpec): string {
  const n = parseNum(raw);
  if (!Number.isFinite(n)) return raw;
  if (unit === 'value' || unit === 'riskMoney') return fmtNumber(n, 2);
  if (unit === 'units') return fmtNumber(n, Math.min(decimalsTyped(raw), qtyPrecision(spec)));
  return fmtNumber(n, Math.min(decimalsTyped(raw), 2));
}

// ---------------------------------------------------------------------------
// Exits
// ---------------------------------------------------------------------------

export const EXIT_UNITS: ExitUnit[] = ['price', 'ticks', 'percent', 'money', 'balancePercent'];

/** Forex measures distances in pips (symbol spec `pipSize`), everything else in ticks. */
const stepWord = (spec?: Pick<SymbolSpec, 'pipSize'>) => (spec?.pipSize ? 'pips' : 'ticks');

/** Decimals of a typed exit value: price precision, pips with one decimal, ticks whole, the rest 2. */
export function exitDecimals(unit: ExitUnit, spec: SymbolSpec): number {
  return unit === 'price' ? pricePrecision(spec) : unit === 'ticks' ? (spec.pipSize ? 1 : 0) : 2;
}

export function exitUnitLabel(kind: ExitKind, unit: ExitUnit, spec?: Pick<SymbolSpec, 'pipSize'>): string {
  switch (unit) {
    case 'price':
      return 'price';
    case 'ticks':
      return stepWord(spec);
    case 'percent':
      return '% of price';
    case 'money':
      return kind === 'sl' ? 'Risk USD' : 'Reward USD';
    case 'balancePercent':
      return kind === 'sl' ? 'Risk % balance' : 'Reward % balance';
  }
}

export function exitTitle(kind: ExitKind): string {
  return kind === 'sl' ? 'Stop loss' : 'Take profit';
}

/** Grey text of an empty level without a quote; normally the field shows a numeric placeholder (see ExitView.placeholder). */
export function exitPlaceholder(): string {
  return DASH;
}

/** "Stop loss must be below entry" — side-aware wrong-side message. */
export function exitWrongSideText(kind: ExitKind, side: Side): string {
  const below = (kind === 'sl') === (side === 'buy');
  return `${exitTitle(kind)} must be ${below ? 'below' : 'above'} entry`;
}

/** Field texts for one exit level. `money` overrides the level's money (TP levels use their own quantity). */
export function levelText(kind: ExitKind, unit: ExitUnit, lvl: ExitLevel | null, side: Side, spec: SymbolSpec, hasQty: boolean, money?: number): FieldText {
  // The unit is in the field label ("Stop loss ticks ▾"), so the value has no suffix.
  const suffix = '';
  const empty: FieldText = { suffix, right: '', rightTone: 'neutral', caption: null, captionTone: 'neutral' };
  if (!lvl) return empty;
  if (lvl.invalid) return { ...empty, caption: exitWrongSideText(kind, side), captionTone: 'error' };
  const moneyText = hasQty ? signedMoney(money ?? lvl.money) : '';
  // Money in the SL / TP fields is grey: the colours live in the summary only.
  const moneyTone: Tone = 'neutral';
  // Forex shows the distance in pips ("−40.0 pips"), the rest as a price difference.
  const delta = spec.pipSize ? `${signed(lvl.delta / spec.pipSize, 1)} pips` : signed(lvl.delta, pricePrecision(spec));
  const pct = `${signed(lvl.deltaPercent, 2)}%`;
  const at = `At ${fmtPrice(lvl.price, spec)}`;
  switch (unit) {
    case 'price':
      return { suffix, right: moneyText, rightTone: moneyTone, caption: `${delta} (${pct}) from entry`, captionTone: 'neutral' };
    case 'ticks':
      return { suffix, right: moneyText, rightTone: moneyTone, caption: `${at} · ${pct} from entry`, captionTone: 'neutral' };
    case 'percent':
      return { suffix, right: moneyText, rightTone: moneyTone, caption: `${at} · ${delta} from entry`, captionTone: 'neutral' };
    case 'money':
      return { suffix, right: fmtPrice(lvl.price, spec), rightTone: 'neutral', caption: `${delta} (${pct}) from entry`, captionTone: 'neutral' };
    case 'balancePercent':
      return { suffix, right: moneyText, rightTone: moneyTone, caption: `${at} · ${delta} (${pct}) from entry`, captionTone: 'neutral' };
  }
}

/**
 * Field texts of SL / TP. Switched off: no caption, grey money on the right for the placeholder level (only with a
 * quantity) — pass the slow view so it moves with the placeholder.
 */
export function exitText(kind: ExitKind, state: TicketState, view: TicketView, spec: SymbolSpec): FieldText {
  const ex = view[kind];
  if (!ex.enabled) {
    const lvl = ex.placeholderLevel;
    const t = lvl && !lvl.invalid ? levelText(kind, ex.unit, lvl, state.side, spec, view.qty.units > 0) : null;
    return { suffix: '', right: t?.right ?? '', rightTone: 'muted', caption: null, captionTone: 'neutral' };
  }
  return levelText(kind, ex.unit, ex.level, state.side, spec, view.qty.units > 0);
}

/** How the typed exit value reads when the field is not focused. */
export function formatExitInput(raw: string, unit: ExitUnit, spec: SymbolSpec): string {
  const n = parseNum(raw);
  if (!Number.isFinite(n)) return raw;
  if (unit === 'price') return fmtPrice(n, spec);
  if (unit === 'ticks') return fmtNumber(n, spec.pipSize ? 1 : 0);
  if (unit === 'money') return fmtNumber(n, 2);
  return fmtNumber(n, Math.min(decimalsTyped(raw), 2));
}

function exitValueText(unit: ExitUnit, n: number, spec: SymbolSpec): string {
  switch (unit) {
    case 'price':
      return fmtPrice(n, spec);
    case 'ticks':
      return fmtNumber(n, spec.pipSize ? 1 : 0);
    case 'money':
      return fmtMoney(Math.abs(n));
    case 'percent':
    case 'balancePercent':
      return pct(Math.abs(n));
  }
}

/**
 * Live value of the level in a unit, for the label menu: the selected unit shows what was typed, the rest are
 * recalculated from it; "—" when the level is off or cannot be computed. No sign (Sell too).
 */
export function exitMenuValue(kind: ExitKind, unit: ExitUnit, state: TicketState, view: TicketView, spec: SymbolSpec): string {
  const ex = view[kind];
  if (!ex.enabled) return DASH;
  const typed = parseNum(state[kind].input);
  if (unit === ex.unit && Number.isFinite(typed)) return exitValueText(unit, typed, spec);
  const lvl = ex.level;
  if (!lvl || lvl.invalid) return DASH;
  if ((unit === 'money' || unit === 'balancePercent') && !(view.qty.units > 0)) return DASH;
  const n = { price: lvl.price, ticks: lvl.ticks, percent: lvl.percent, money: lvl.money, balancePercent: lvl.balancePercent }[unit];
  return exitValueText(unit, n, spec);
}

/**
 * Live value of a partial exit's leg in a unit, for its label menu: what was typed for the selected unit, the rest
 * recalculated from the level; "—" without a level (empty leg, no entry price) and for money units without shares.
 */
export function levelMenuValue(unit: ExitUnit, typed: { unit: ExitUnit; input: string }, lvl: ExitLevel | null, hasQty: boolean, spec: SymbolSpec): string {
  const n = parseNum(typed.input);
  if (unit === typed.unit && Number.isFinite(n)) return exitValueText(unit, n, spec);
  if (!lvl || lvl.invalid) return DASH;
  if ((unit === 'money' || unit === 'balancePercent') && !hasQty) return DASH;
  const v = { price: lvl.price, ticks: lvl.ticks, percent: lvl.percent, money: lvl.money, balancePercent: lvl.balancePercent }[unit];
  return exitValueText(unit, v, spec);
}

/** "Buy Limit 100 @ 199.00" — the order the level editor belongs to. */
export function orderTitleText(state: TicketState, view: TicketView, spec: SymbolSpec): string {
  const type = state.type === 'market' ? 'Market' : state.type === 'limit' ? 'Limit' : 'Stop';
  const side = state.side === 'buy' ? 'Buy' : 'Sell';
  const px = view.entry !== null ? ` @ ${fmtPrice(view.entry, spec)}` : '';
  const qty = view.qty.units > 0 ? ` ${fmtQty(view.qty.units, spec)}` : '';
  return `${side} ${type}${qty}${px}`;
}

/** "50%", "33.33%", "0.24%": at most 2 decimals, no trailing zeros. */
export function levelPercentText(percent: number): string {
  return `${fmtNumber(percent, 2).replace(/\.?0+$/, '')}%`;
}

/** Heading of a level: "Exit 1 · 50 shares · 50%" (n counts from 1 in the order of the list). */
export function exitHeadingText(n: number, qty: number, percent: number, spec: SymbolSpec): string {
  return `Exit ${n} · ${unitsText(qty, spec)} · ${levelPercentText(percent)}`;
}

/** One part of a level row: `TP 50 @ 206.00`, `TP off`, `SL off` (orange), a wrong-side leg is red. */
export type LevelRowPart = { label: 'TP' | 'SL'; text: string; tone: 'normal' | 'off' | 'error' };

/** Row of a level: "TP 50 @ 206.00 · SL 50 @ 197.50". Prices to the symbol's precision, shares without trailing zeros. */
export function levelRowParts(state: TicketState, view: TicketView, index: number, spec: SymbolSpec): LevelRowPart[] {
  const v = view.levels[index];
  return (['tp', 'sl'] as const).map((kind) => {
    const leg = v[kind];
    const label = kind === 'tp' ? 'TP' : 'SL';
    const typed = state.levels[index][kind];
    if (leg.error) return { label, text: `${fmtQty(v.qty, spec)} @ ${legPriceText(leg.level, typed, spec) ?? DASH}`, tone: 'error' as const };
    const price = legPriceText(leg.level, typed, spec);
    if (price === null) return { label, text: 'off', tone: 'off' as const };
    return { label, text: `${fmtQty(v.qty, spec)} @ ${price}`, tone: 'normal' as const };
  });
}

/** The price of a leg: the level's, else the typed price (before an entry exists); null when the leg is off. */
function legPriceText(level: ExitLevel | null, typed: { unit: ExitUnit; input: string }, spec: SymbolSpec): string | null {
  if (level) return fmtPrice(level.price, spec);
  const n = parseNum(typed.input);
  if (!Number.isFinite(n)) return null;
  return typed.unit === 'price' ? fmtPrice(n, spec) : `${formatExitInput(typed.input, typed.unit, spec)} ${exitUnitLabel('tp', typed.unit, spec)}`;
}

/**
 * While quantity is sized by risk, the stop loss cannot be set in money units: the risk sets the quantity, not the level.
 * SL shows Risk USD / Risk % balance disabled with this reason. The TP menu does not change.
 */
export function exitUnitBlocked(kind: ExitKind, unit: ExitUnit, state: TicketState): string | null {
  if (kind !== 'sl' || !isRiskUnit(state.qtyUnit) || (unit !== 'money' && unit !== 'balancePercent')) return null;
  return `Not available while quantity is in ${state.qtyUnit === 'riskMoney' ? 'Risk USD' : 'Risk % balance'}`;
}

/** Units in the SL / TP menus (all of them; see exitUnitBlocked for the disabled ones). */
export function exitUnitsFor(): ExitUnit[] {
  return EXIT_UNITS;
}

/** ⓘ text of an SL / TP menu item (none for Price). */
export function exitUnitInfo(kind: ExitKind, unit: ExitUnit, spec?: Pick<SymbolSpec, 'pipSize'>): string | undefined {
  const sl = kind === 'sl';
  switch (unit) {
    case 'price':
      return undefined;
    case 'ticks':
      return `Distance from entry in ${stepWord(spec)}`;
    case 'percent':
      return 'Distance from entry as % of price';
    case 'money':
      return sl ? 'Loss if triggered' : 'Profit if triggered';
    case 'balancePercent':
      return sl ? 'Loss as % of balance' : 'Profit as % of balance';
  }
}

// ---------------------------------------------------------------------------
// Risk / Reward, summary, submit, time in force, session
// ---------------------------------------------------------------------------

export function riskRewardText(rr: number): string {
  return `1 : ${fmtNumber(rr, 2)}`;
}

/** A segment of the summary above the button. */
export type SummaryPart = {
  label: 'SL' | 'TP' | null;
  /** "up to" before the amount */
  prefix?: string;
  amount: string;
  kind: 'sl' | 'tp' | 'exits' | 'warning';
};

/**
 * Summary above the button, segments in this order: SL total · TP total ("up to" with 2+ take profits) · "N exits" (2+
 * levels) · warnings. R:R is not shown here.
 *   SL −407.00 USD · TP up to +818.00 USD · 3 exits
 *   SL −325.60 USD · TP +754.40 USD · 20 shares without SL/TP
 *   TP +943.00 USD · No stop loss
 */
export function summaryParts(view: TicketView, spec: SymbolSpec): SummaryPart[] | null {
  const m = view.summary;
  if (!m) return null;
  const parts: SummaryPart[] = [];
  if (m.sl !== null) parts.push({ label: 'SL', amount: signedMoney(m.sl), kind: 'sl' });
  if (m.tp !== null) parts.push({ label: 'TP', prefix: m.tpCount >= 2 ? 'up to' : undefined, amount: signedMoney(m.tp), kind: 'tp' });
  if (m.levels >= 2) parts.push({ label: null, amount: `${m.levels} exits`, kind: 'exits' });
  if (m.unprotectedQty > 0) parts.push({ label: null, amount: `${unitsText(m.unprotectedQty, spec)} without SL/TP`, kind: 'warning' });
  if (m.noStop) parts.push({ label: null, amount: 'No stop loss', kind: 'warning' });
  return parts.length ? parts : null;
}

/** Plain-text summary. */
export function summaryText(view: TicketView, spec: SymbolSpec): string | null {
  return summaryParts(view, spec)?.map((p) => [p.label, p.prefix, p.amount].filter(Boolean).join(' ')).join(' · ') ?? null;
}

export type SubmitText = { primary: string; secondary: string; disabled: boolean; reason: string | null };

const TYPE_SHORT = { market: 'MKT', limit: 'LMT', stop: 'STP' } as const;

/** "till Oct 15"; Day — "till 4:00 PM" (the session close); GTD — "till Oct 24" (date only). Market has none. */
export function tillText(state: TicketState, expiresAt: number, spec: SymbolSpec): string {
  return state.tif === 'day' ? `till ${closeLabel(spec)}` : `till ${shortDate(expiresAt)}`;
}

export function submitText(state: TicketState, view: TicketView, spec: SymbolSpec): SubmitText {
  const primary = state.side === 'buy' ? 'Buy' : 'Sell';
  const verb = state.side === 'buy' ? 'buy' : 'sell';
  const block = (reason: string): SubmitText => ({ primary, secondary: reason, disabled: true, reason });
  const needPrice = state.type !== 'market' && view.price?.value == null;
  if (!view.ready) return block('Waiting for market data');
  if (isRiskUnit(state.qtyUnit) && view.qty.needsStopLoss) return block('Set stop loss to calculate size');
  if (view.qty.riskBelowOne && view.qty.riskPerUnit !== null) return block(riskTooSmallText(view.qty.riskPerUnit, spec));
  if (needPrice && !(view.qty.units > 0)) return block('Enter price and quantity');
  if (needPrice) return block('Enter price');
  if (!(view.qty.units > 0)) return block(`Enter quantity to ${verb} ${spec.symbol}`);
  if (view.qty.units < spec.minQty) return block(`Minimum quantity is ${fmtQty(spec.minQty, spec)}`);
  for (const kind of state.levels.length >= 2 ? [] : (['sl', 'tp'] as const)) {
    const ex = view[kind];
    if (!ex.enabled) continue;
    if (!ex.level) return block(`Enter ${exitTitle(kind).toLowerCase()}`);
    if (ex.level.invalid) return block(exitWrongSideText(kind, state.side));
  }
  if (view.exitsError) return block(view.exitsError);
  if (view.marginExceeded) return block('Not enough margin');
  if (!view.canSubmit || !view.draft) return block(view.disabledText ?? 'Check the order');
  const qty = `${fmtQty(view.qty.units, spec)} ${spec.symbol}`;
  if (state.type === 'market') return { primary, secondary: `${qty} · MKT${view.opensAt !== null ? ' · at open' : ''}`, disabled: false, reason: null };
  const px = fmtPrice(view.price!.value!, spec, { grouping: false });
  const till = view.expiresAt !== null ? ` · ${tillText(state, view.expiresAt, spec)}` : '';
  return { primary, secondary: `${qty} · ${TYPE_SHORT[state.type]} ${px}${till}`, disabled: false, reason: null };
}

const TIF_LABEL: Record<TimeInForce, string> = { day: 'Day', week: 'Week', month: 'Month', gtd: 'On date (GTD)' };
export const TIFS: TimeInForce[] = ['day', 'week', 'month', 'gtd'];

/** "4:00 PM" from "16:00". */
function clock12(hhmmText: string): string {
  const [h, m] = hhmmText.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The session close as shown: "4:00 PM" (stocks); 24 h markets expire at the end of the day, "11:59 PM". */
export function closeLabel(spec: SymbolSpec): string {
  return clock12(sessionCloseTime(spec.symbol) || '23:59');
}

/** GTD time as typed, or the default close. */
export function gtdTimeOrClose(state: Pick<TicketState, 'gtdTime'>, spec: SymbolSpec): string {
  return state.gtdTime || sessionCloseTime(spec.symbol) || '23:59';
}

function gtdMs(state: Pick<TicketState, 'gtdDate' | 'gtdTime'>, spec: SymbolSpec): number | undefined {
  return state.gtdDate ? new Date(`${state.gtdDate}T${gtdTimeOrClose(state, spec)}:00`).getTime() : undefined;
}

/**
 * The value of an Expires choice, on its own: "Today, 4:00 PM" (Day), "Oct 15" (Week), "Nov 8" (Month),
 * "Oct 24, 4:00 PM" (GTD), "Pick a date" while no date is chosen. Dates count from `now`.
 */
export function expiresValue(tif: TimeInForce, now: number, state: Pick<TicketState, 'gtdDate' | 'gtdTime'>, spec: SymbolSpec): string {
  switch (tif) {
    case 'day':
      return `Today, ${closeLabel(spec)}`;
    case 'week':
    case 'month':
      return shortDate(computeExpiry(tif, now));
    case 'gtd': {
      const g = gtdMs(state, spec);
      return g ? `${shortDate(g)}, ${clock12(gtdTimeOrClose(state, spec))}` : 'Pick a date';
    }
  }
}

/** Row value of the Expires row: the date only ("Oct 15"), no name of the choice. */
export function expiresRowText(state: TicketState, now: number, spec: SymbolSpec): string {
  return expiresValue(state.tif, now, state, spec);
}

/** Menu item: the name on the left, the date on the right (grey). */
export function expiresMenuItem(tif: TimeInForce, now: number, state: TicketState, spec: SymbolSpec): { label: string; value: string } {
  return { label: TIF_LABEL[tif], value: expiresValue(tif, now, state, spec) };
}

/** "Market is closed · opens Mon 15:30" in local time. */
export function marketClosedText(opensAt: number): string {
  const d = new Date(opensAt);
  return `Market is closed · opens ${d.toLocaleDateString('en-US', { weekday: 'short' })} ${hhmm(opensAt)}`;
}

/** Toast after a market fill: "Bought 100 AAPL at 201.57". */
export function fillToastText(side: Side, qty: number, price: number, spec: SymbolSpec): string {
  return `${side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(qty, spec)} ${spec.symbol} at ${fmtPrice(price, spec)}`;
}

/** Toast after placing a resting order: "Buy limit 100 AAPL at 199.00 placed". */
export function placedToastText(side: Side, type: OrderType, qty: number, price: number | undefined, spec: SymbolSpec): string {
  const kind = type === 'market' ? 'market' : type;
  const at = price !== undefined ? ` at ${fmtPrice(price, spec)}` : ' at open';
  return `${side === 'buy' ? 'Buy' : 'Sell'} ${kind} ${fmtQty(qty, spec)} ${spec.symbol}${at} placed`;
}

export { MINUS };
