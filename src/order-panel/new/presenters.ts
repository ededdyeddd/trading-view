/**
 * Text presenters for the redesigned ticket: turn TicketView numbers into the exact strings of the
 * Figma tables (left value · right value · caption). No math here — numbers come from orderMath via deriveTicket.
 */
import { pricePrecision, qtyPrecision, type SymbolSpec } from '../../config/symbols';
import { computeExpiry } from '../../engine/paperEngine';
import type { TimeInForce } from '../../engine/types';
import { fmtMoney, fmtNumber, fmtPrice, fmtQty, parseNum } from '../../lib/format';
import type { ExitKind, ExitUnit, QtyUnit, Side } from '../../lib/orderMath';
import type { TicketState, TicketView } from '../../order-ticket/types';

export type Tone = 'neutral' | 'danger' | 'success';
export type CaptionTone = 'neutral' | 'error' | 'warning';

export type FieldText = {
  /** Unit suffix rendered right after the typed value ("ticks", "% of price", "USD"). */
  suffix: string;
  /** Second value on the right side of the field. */
  right: string;
  rightTone: Tone;
  caption: string | null;
  captionTone: CaptionTone;
};

const MINUS = '−';

export function signed(n: number, digits: number): string {
  return fmtNumber(n, digits, { sign: true });
}

export function signedMoney(n: number): string {
  return `${fmtMoney(n, { sign: true })} USD`;
}

function sharesWord(spec: SymbolSpec): string {
  return spec.qtyLabel.toLowerCase();
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

export const QTY_UNITS_2A: { unit: QtyUnit; enabled: boolean }[] = [
  { unit: 'units', enabled: true },
  { unit: 'value', enabled: true },
  { unit: 'balancePercent', enabled: true },
  { unit: 'riskMoney', enabled: false },
  { unit: 'riskBalancePercent', enabled: false },
];

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

export function qtySuffix(unit: QtyUnit): string {
  if (unit === 'value' || unit === 'riskMoney') return 'USD';
  if (unit === 'balancePercent' || unit === 'riskBalancePercent') return '%';
  return '';
}

/** Live value of the current quantity in another unit, for the label menu. */
export function qtyMenuValue(unit: QtyUnit, view: TicketView, spec: SymbolSpec): string {
  const eq = view.qty.equivalents;
  switch (unit) {
    case 'units':
      return `${fmtQty(eq.units, spec)} ${sharesWord(spec)}`;
    case 'value':
      return `${fmtMoney(eq.value)} USD`;
    case 'balancePercent':
      return `${fmtNumber(eq.balancePercent, 2)} %`;
    default:
      return '';
  }
}

export function qtyText(state: TicketState, view: TicketView, spec: SymbolSpec): FieldText {
  const units = view.qty.units;
  const right = state.qtyUnit === 'units' ? `${fmtMoney(view.qty.tradeValue)} USD` : `${fmtQty(units, spec)} ${sharesWord(spec)}`;
  let caption: string;
  let captionTone: CaptionTone = 'neutral';
  if (units > 0 && view.marginExceeded) {
    caption = `Not enough margin · Available ${fmtMoney(view.availableFunds)} USD`;
    captionTone = 'error';
  } else if (units > 0) {
    caption = `Margin ${fmtMoney(view.qty.margin)} USD · Tick ${fmtMoney(view.qty.tickValue)} USD`;
  } else {
    caption = `Available margin ${fmtMoney(view.availableFunds)} USD`;
  }
  return { suffix: qtySuffix(state.qtyUnit), right, rightTone: 'neutral', caption, captionTone };
}

/** How the typed quantity reads when the field is not focused ("20,000.00", "100"). */
export function formatQtyInput(raw: string, unit: QtyUnit, spec: SymbolSpec): string {
  const n = parseNum(raw);
  if (!Number.isFinite(n)) return raw;
  if (unit === 'value' || unit === 'riskMoney') return fmtNumber(n, 2);
  if (unit === 'units') return fmtNumber(n, Math.min(decimalsTyped(raw), qtyPrecision(spec)));
  return fmtNumber(n, Math.min(decimalsTyped(raw), 2));
}

function decimalsTyped(raw: string): number {
  const i = raw.indexOf('.');
  return i < 0 ? 0 : raw.length - i - 1;
}

// ---------------------------------------------------------------------------
// Exits
// ---------------------------------------------------------------------------

export const EXIT_UNITS: ExitUnit[] = ['price', 'ticks', 'percent', 'money', 'balancePercent'];

export function exitUnitLabel(kind: ExitKind, unit: ExitUnit): string {
  switch (unit) {
    case 'price':
      return 'price';
    case 'ticks':
      return 'ticks';
    case 'percent':
      return '% price';
    case 'money':
      return kind === 'sl' ? 'Risk USD' : 'Reward USD';
    case 'balancePercent':
      return kind === 'sl' ? 'Risk % balance' : 'Reward % balance';
  }
}

export function exitTitle(kind: ExitKind): string {
  return kind === 'sl' ? 'Stop loss' : 'Take profit';
}

export function exitSuffix(unit: ExitUnit): string {
  switch (unit) {
    case 'price':
      return '';
    case 'ticks':
      return 'ticks';
    case 'percent':
      return '% of price';
    case 'money':
      return 'USD';
    case 'balancePercent':
      return '% of balance';
  }
}

export function exitPlaceholder(unit: ExitUnit): string {
  switch (unit) {
    case 'price':
      return 'Enter price';
    case 'ticks':
      return 'Enter ticks';
    case 'percent':
      return 'Enter %';
    case 'money':
      return 'Enter amount';
    case 'balancePercent':
      return 'Enter %';
  }
}

/** "Stop loss must be below entry" — side-aware wrong-side message. */
export function exitWrongSideText(kind: ExitKind, side: Side): string {
  const below = (kind === 'sl') === (side === 'buy');
  return `${exitTitle(kind)} must be ${below ? 'below' : 'above'} entry`;
}

export function exitText(kind: ExitKind, state: TicketState, view: TicketView, spec: SymbolSpec): FieldText {
  const ex = view[kind];
  const lvl = ex.level;
  const suffix = exitSuffix(ex.unit);
  const empty: FieldText = { suffix, right: '', rightTone: 'neutral', caption: null, captionTone: 'neutral' };
  if (!ex.enabled || !lvl) return empty;
  if (lvl.invalid) {
    return { ...empty, caption: exitWrongSideText(kind, state.side), captionTone: 'error' };
  }
  const money = view.qty.units > 0 ? signedMoney(lvl.money) : '';
  const moneyTone: Tone = kind === 'sl' ? 'danger' : 'success';
  const pd = pricePrecision(spec);
  const delta = signed(lvl.delta, pd);
  const pct = `${signed(lvl.deltaPercent, 2)}%`;
  const at = `At ${fmtPrice(lvl.price, spec)}`;
  switch (ex.unit) {
    case 'price':
      return { suffix, right: money, rightTone: moneyTone, caption: `${delta} (${pct}) from entry`, captionTone: 'neutral' };
    case 'ticks':
      return { suffix, right: money, rightTone: moneyTone, caption: `${at} · ${pct} from entry`, captionTone: 'neutral' };
    case 'percent':
      return { suffix, right: money, rightTone: moneyTone, caption: `${at} · ${delta} from entry`, captionTone: 'neutral' };
    case 'money':
      return { suffix, right: fmtPrice(lvl.price, spec), rightTone: 'neutral', caption: `${delta} (${pct}) from entry`, captionTone: 'neutral' };
    case 'balancePercent':
      return { suffix, right: money, rightTone: moneyTone, caption: `${at} · ${delta} (${pct}) from entry`, captionTone: 'neutral' };
  }
}

/** How the typed exit value reads when the field is not focused. */
export function formatExitInput(raw: string, unit: ExitUnit, spec: SymbolSpec): string {
  const n = parseNum(raw);
  if (!Number.isFinite(n)) return raw;
  if (unit === 'price') return fmtPrice(n, spec);
  if (unit === 'ticks') return fmtNumber(n, 0);
  if (unit === 'money') return fmtNumber(n, 2);
  return fmtNumber(n, Math.min(decimalsTyped(raw), 2));
}

/** Live value of the current level in another unit, for the label menu. */
export function exitMenuValue(kind: ExitKind, unit: ExitUnit, view: TicketView, spec: SymbolSpec): string {
  const lvl = view[kind].level;
  if (!lvl || lvl.invalid) return '';
  switch (unit) {
    case 'price':
      return fmtPrice(lvl.price, spec);
    case 'ticks':
      return `${fmtNumber(lvl.ticks, 0)} ticks`;
    case 'percent':
      return `${fmtNumber(lvl.percent, 2)} %`;
    case 'money':
      return view.qty.units > 0 ? `${fmtMoney(Math.abs(lvl.money))} USD` : '';
    case 'balancePercent':
      return view.qty.units > 0 ? `${fmtNumber(lvl.balancePercent, 2)} %` : '';
  }
}

// ---------------------------------------------------------------------------
// Risk / Reward, summary, submit, time in force
// ---------------------------------------------------------------------------

export function riskRewardText(rr: number): string {
  return `1 : ${fmtNumber(rr, 2)}`;
}

export function summaryText(view: TicketView): string | null {
  const parts: string[] = [];
  if (view.sl.enabled && view.sl.level && !view.sl.level.invalid) parts.push(`SL ${signedMoney(view.sl.level.money)}`);
  if (view.tp.enabled && view.tp.level && !view.tp.level.invalid) parts.push(`TP ${signedMoney(view.tp.level.money)}`);
  return parts.length ? parts.join(' · ') : null;
}

export type SubmitText = { primary: string; secondary: string; disabled: boolean; reason: string | null };

const TYPE_SHORT = { market: 'MKT', limit: 'LMT', stop: 'STP' } as const;

export function submitText(state: TicketState, view: TicketView, spec: SymbolSpec): SubmitText {
  const primary = state.side === 'buy' ? 'Buy' : 'Sell';
  const verb = state.side === 'buy' ? 'buy' : 'sell';
  const block = (reason: string): SubmitText => ({ primary, secondary: reason, disabled: true, reason });
  if (!view.ready) return block('Waiting for market data');
  if (!(view.qty.units > 0)) return block(`Enter quantity to ${verb} ${spec.symbol}`);
  if (view.qty.units < spec.minQty) return block(`Minimum quantity is ${fmtQty(spec.minQty, spec)}`);
  for (const kind of ['sl', 'tp'] as const) {
    const ex = view[kind];
    if (!ex.enabled) continue;
    if (!ex.level) return block(`Enter ${exitTitle(kind).toLowerCase()}`);
    if (ex.level.invalid) return block(exitWrongSideText(kind, state.side));
  }
  if (view.marginExceeded) return block('Not enough margin');
  if (!view.canSubmit || !view.draft) return block(view.disabledText ?? 'Check the order');
  return { primary, secondary: `${fmtQty(view.qty.units, spec)} ${spec.symbol} · ${TYPE_SHORT[state.type]}`, disabled: false, reason: null };
}

const TIF_LABEL: Record<TimeInForce, string> = { day: 'Day', week: 'Week', month: 'Month', gtd: 'GTD' };

/** "Week · Oct 16" — period plus the expiry date (computed from today, also for market orders). */
export function tifText(tif: TimeInForce, now: number, gtd?: number): string {
  const expiry = computeExpiry(tif, now, gtd);
  return `${TIF_LABEL[tif]} · ${new Date(expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** Toast after a market fill: "Bought 100 AAPL at 201.57". */
export function fillToastText(side: Side, qty: number, price: number, spec: SymbolSpec): string {
  return `${side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(qty, spec)} ${spec.symbol} at ${fmtPrice(price, spec)}`;
}

export { MINUS };
