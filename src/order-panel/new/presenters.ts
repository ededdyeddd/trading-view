/**
 * Text presenters for the redesigned ticket: turn TicketView numbers into the exact strings of the
 * Figma / PRD tables (left value · right value · caption). No math here — numbers come from orderMath via deriveTicket.
 */
import { pricePrecision, qtyPrecision, type SymbolSpec } from '../../config/symbols';
import { computeExpiry } from '../../engine/paperEngine';
import type { TimeInForce } from '../../engine/types';
import { fmtMoney, fmtNumber, fmtPrice, fmtQty, parseNum } from '../../lib/format';
import type { ExitKind, ExitLevel, ExitUnit, OrderType, QtyUnit, Side } from '../../lib/orderMath';
import type { PriceUnit, TicketState, TicketView } from '../../order-ticket/types';

export type Tone = 'neutral' | 'danger' | 'success' | 'warning';
export type CaptionTone = 'neutral' | 'error' | 'warning';

export type FieldText = {
  /** Unit suffix rendered right after the typed value ("ticks", "% of price", "USD"). */
  suffix: string;
  /** Second value on the right side of the field. */
  right: string;
  rightTone: Tone;
  caption: string | null;
  captionTone: CaptionTone;
  /** The caption is a link that switches the stop loss on (risk sizing without SL). */
  captionAction?: 'enable-sl';
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

export function priceLabel(type: OrderType): string {
  return type === 'stop' ? 'Stop Price' : 'Limit Price';
}

export function priceUnitLabel(unit: PriceUnit, side: Side): string {
  return unit === 'price' ? 'Price' : `Ticks from ${side === 'buy' ? 'Ask' : 'Bid'}`;
}

/** "Ask − 2.57", "Bid + 3.44", "Ask" when equal. */
export function offsetText(view: TicketView, spec: SymbolSpec): string {
  const p = view.price;
  if (!p || p.offset === null) return '';
  if (p.offset === 0) return p.ref;
  return `${p.ref} ${p.offset > 0 ? '+' : MINUS} ${fmtPrice(Math.abs(p.offset), spec)}`;
}

/** Warning when the order would execute at once. Not a block. */
export function priceWarning(type: OrderType, side: Side, view: TicketView): string | null {
  const p = view.price;
  if (!p || p.value === null) return null;
  if (type === 'limit' && p.fillsNow) return side === 'buy' ? 'Fills now: price is above Ask' : 'Fills now: price is below Bid';
  if (type === 'stop' && p.invalid) return side === 'buy' ? 'Triggers now: price is below Ask' : 'Triggers now: price is above Bid';
  return null;
}

export function priceText(state: TicketState, view: TicketView, spec: SymbolSpec): FieldText & { placeholder: string } {
  const p = view.price;
  const warning = priceWarning(state.type, state.side, view);
  const tone: Tone = warning ? 'warning' : 'neutral';
  if (!p) return { suffix: '', right: '', rightTone: 'neutral', caption: null, captionTone: 'neutral', placeholder: '' };
  if (p.unit === 'ticks') {
    return {
      suffix: `ticks ${p.direction}`,
      right: p.value !== null ? fmtPrice(p.value, spec) : '',
      rightTone: tone,
      caption: warning,
      captionTone: warning ? 'warning' : 'neutral',
      placeholder: '0',
    };
  }
  return {
    suffix: '',
    right: offsetText(view, spec),
    rightTone: tone,
    caption: warning,
    captionTone: warning ? 'warning' : 'neutral',
    placeholder: view.ready ? fmtPrice(p.placeholder, spec, { grouping: false }) : '',
  };
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

export const QTY_UNITS: QtyUnit[] = ['units', 'value', 'balancePercent', 'riskMoney', 'riskBalancePercent'];

export function isRiskUnit(unit: QtyUnit): boolean {
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

export function qtySuffix(unit: QtyUnit): string {
  if (unit === 'value' || unit === 'riskMoney') return 'USD';
  if (unit === 'balancePercent') return '%';
  if (unit === 'riskBalancePercent') return '% of balance';
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
    case 'riskMoney':
      return eq.riskMoney === null ? '—' : `${fmtMoney(eq.riskMoney)} USD`;
    case 'riskBalancePercent':
      return eq.riskBalancePercent === null ? '—' : `${fmtNumber(eq.riskBalancePercent, 2)} %`;
  }
}

export function qtyText(state: TicketState, view: TicketView, spec: SymbolSpec): FieldText {
  const units = view.qty.units;
  const risk = isRiskUnit(state.qtyUnit);
  const suffix = qtySuffix(state.qtyUnit);
  const shares = `${fmtQty(units, spec)} ${sharesWord(spec)}`;
  if (risk && view.qty.needsStopLoss) {
    return { suffix, right: '—', rightTone: 'neutral', caption: 'Turn on stop loss to calculate shares', captionTone: 'neutral', captionAction: 'enable-sl' };
  }
  if (risk && view.qty.riskBelowOne && view.qty.riskPerUnit !== null) {
    return { suffix, right: shares, rightTone: 'neutral', caption: `Risk is below 1 share (${fmtMoney(view.qty.riskPerUnit)} USD)`, captionTone: 'error' };
  }
  const right = state.qtyUnit === 'units' ? `${fmtMoney(view.qty.tradeValue)} USD` : shares;
  if (units > 0 && view.marginExceeded) {
    return {
      suffix,
      right,
      rightTone: 'neutral',
      caption: `Not enough margin for ${fmtQty(units, spec)} shares · max ${fmtQty(view.qty.maxUnits, spec)}`,
      captionTone: 'error',
    };
  }
  if (units > 0 && risk && view.qty.realRisk !== null) {
    return {
      suffix,
      right,
      rightTone: 'neutral',
      caption: `Real risk ${fmtMoney(view.qty.realRisk)} USD · Margin ${fmtMoney(view.qty.margin)} USD`,
      captionTone: 'neutral',
    };
  }
  if (units > 0) {
    return {
      suffix,
      right,
      rightTone: 'neutral',
      caption: `Margin ${fmtMoney(view.qty.margin)} USD · Tick ${fmtMoney(view.qty.tickValue)} USD`,
      captionTone: 'neutral',
    };
  }
  return { suffix, right, rightTone: 'neutral', caption: `Available margin ${fmtMoney(view.availableFunds)} USD`, captionTone: 'neutral' };
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

/** Field texts for one exit level. `money` overrides the level's money (TP levels use their own quantity). */
export function levelText(kind: ExitKind, unit: ExitUnit, lvl: ExitLevel | null, side: Side, spec: SymbolSpec, hasQty: boolean, money?: number): FieldText {
  const suffix = exitSuffix(unit);
  const empty: FieldText = { suffix, right: '', rightTone: 'neutral', caption: null, captionTone: 'neutral' };
  if (!lvl) return empty;
  if (lvl.invalid) return { ...empty, caption: exitWrongSideText(kind, side), captionTone: 'error' };
  const moneyText = hasQty ? signedMoney(money ?? lvl.money) : '';
  const moneyTone: Tone = kind === 'sl' ? 'danger' : 'success';
  const delta = signed(lvl.delta, pricePrecision(spec));
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

export function exitText(kind: ExitKind, state: TicketState, view: TicketView, spec: SymbolSpec): FieldText {
  const ex = view[kind];
  if (!ex.enabled) return { suffix: exitSuffix(ex.unit), right: '', rightTone: 'neutral', caption: null, captionTone: 'neutral' };
  // With several TP levels, TP 1's money is its own share.
  const money = kind === 'tp' && view.tpLevels.length > 1 && ex.level && !ex.level.invalid ? tpLevelMoney(view, 0) : undefined;
  return levelText(kind, ex.unit, ex.level, state.side, spec, view.qty.units > 0, money);
}

/** Money of TP level i at its own quantity (levels > 1). */
export function tpLevelMoney(view: TicketView, i: number): number | undefined {
  return view.tpLevels[i]?.money ?? undefined;
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

export function percentLeftText(view: TicketView): string | null {
  return view.tpLevels.length > 1 && view.tpPercentLeft > 0 ? `${fmtNumber(view.tpPercentLeft, 0)}% left` : null;
}

// ---------------------------------------------------------------------------
// Risk / Reward, summary, submit, time in force, session
// ---------------------------------------------------------------------------

export function riskRewardText(rr: number): string {
  return `1 : ${fmtNumber(rr, 2)}`;
}

export function summaryText(view: TicketView): string | null {
  const parts: string[] = [];
  if (view.sl.enabled && view.sl.level && !view.sl.level.invalid) parts.push(`SL ${signedMoney(view.sl.level.money)}`);
  if (view.tp.enabled && view.tpMoney !== null) {
    const n = view.tpLevels.length;
    parts.push(`TP ${signedMoney(view.tpMoney)}${n > 1 ? ` (${n} levels)` : ''}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

export type SubmitText = { primary: string; secondary: string; disabled: boolean; reason: string | null };

const TYPE_SHORT = { market: 'MKT', limit: 'LMT', stop: 'STP' } as const;

/** "till Oct 15" (date) or "till Oct 20 14:30" (GTD with a time). */
export function tillText(state: TicketState, expiresAt: number): string {
  return state.tif === 'gtd' && state.gtdTime ? `till ${shortDate(expiresAt)} ${hhmm(expiresAt)}` : `till ${shortDate(expiresAt)}`;
}

export function submitText(state: TicketState, view: TicketView, spec: SymbolSpec): SubmitText {
  const primary = state.side === 'buy' ? 'Buy' : 'Sell';
  const verb = state.side === 'buy' ? 'buy' : 'sell';
  const block = (reason: string): SubmitText => ({ primary, secondary: reason, disabled: true, reason });
  const needPrice = state.type !== 'market' && view.price?.value == null;
  if (!view.ready) return block('Waiting for market data');
  if (isRiskUnit(state.qtyUnit) && view.qty.needsStopLoss) return block('Set stop loss to calculate size');
  if (view.qty.riskBelowOne) return block('Risk is below 1 share');
  if (needPrice && !(view.qty.units > 0)) return block('Enter price and quantity');
  if (needPrice) return block('Enter price');
  if (!(view.qty.units > 0)) return block(`Enter quantity to ${verb} ${spec.symbol}`);
  if (view.qty.units < spec.minQty) return block(`Minimum quantity is ${fmtQty(spec.minQty, spec)}`);
  for (const kind of ['sl', 'tp'] as const) {
    const ex = view[kind];
    if (!ex.enabled) continue;
    if (!ex.level) return block(`Enter ${exitTitle(kind).toLowerCase()}`);
    if (ex.level.invalid) return block(exitWrongSideText(kind, state.side));
  }
  if (view.tp.enabled && view.tpLevels.slice(1).some((l) => !l.level)) return block('Enter take profit');
  if (view.tp.enabled && view.tpLevels.slice(1).some((l) => l.level?.invalid)) return block(exitWrongSideText('tp', state.side));
  if (view.tp.enabled && view.tpLevels.some((l) => !(l.qty > 0))) return block('Set % of position for each level');
  if (view.marginExceeded) return block('Not enough margin');
  if (!view.canSubmit || !view.draft) return block(view.disabledText ?? 'Check the order');
  const qty = `${fmtQty(view.qty.units, spec)} ${spec.symbol}`;
  if (state.type === 'market') return { primary, secondary: `${qty} · MKT${view.opensAt !== null ? ' · at open' : ''}`, disabled: false, reason: null };
  const px = fmtPrice(view.price!.value!, spec, { grouping: false });
  const till = view.expiresAt !== null ? ` · ${tillText(state, view.expiresAt)}` : '';
  return { primary, secondary: `${qty} · ${TYPE_SHORT[state.type]} ${px}${till}`, disabled: false, reason: null };
}

const TIF_LABEL: Record<TimeInForce, string> = { day: 'Day', week: 'Week', month: 'Month', gtd: 'GTD' };
export const TIFS: TimeInForce[] = ['day', 'week', 'month', 'gtd'];

function gtdMs(state: Pick<TicketState, 'gtdDate' | 'gtdTime'>): number | undefined {
  return state.gtdDate ? new Date(`${state.gtdDate}T${state.gtdTime || '00:00'}:00`).getTime() : undefined;
}

/** Row value: "Week · Oct 16" (computed from today, also for market orders). */
export function tifText(tif: TimeInForce, now: number, gtd?: number): string {
  const expiry = computeExpiry(tif, now, gtd);
  return `${TIF_LABEL[tif]} · ${shortDate(expiry)}`;
}

export function tifRowText(state: TicketState, now: number): string {
  if (state.tif === 'gtd' && !state.gtdDate) return 'GTD';
  const g = gtdMs(state);
  const base = tifText(state.tif, now, g);
  return state.tif === 'gtd' && state.gtdTime && g ? `${base} ${hhmm(g)}` : base;
}

/** Menu item: "Week · till Oct 16"; GTD without a date yet: "GTD · pick a date". */
export function tifMenuText(tif: TimeInForce, now: number, state: TicketState): string {
  if (tif === 'gtd') {
    const g = gtdMs(state);
    return g ? `GTD · till ${shortDate(computeExpiry('gtd', now, g))}${state.gtdTime ? ` ${state.gtdTime}` : ''}` : 'GTD · pick a date';
  }
  return `${TIF_LABEL[tif]} · till ${shortDate(computeExpiry(tif, now))}`;
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
