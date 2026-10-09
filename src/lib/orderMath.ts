/**
 * Pure order math shared by every order panel variant and the paper engine.
 * No React, no store access — everything is passed in.
 */
import type { SymbolSpec } from '../config/symbols';

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';

/** How the quantity is entered. */
export type QtyUnit = 'units' | 'value' | 'balancePercent' | 'riskMoney' | 'riskBalancePercent';
/** How a take-profit / stop-loss level is entered. Money units mean Risk (SL) / Reward (TP). */
export type ExitUnit = 'price' | 'ticks' | 'percent' | 'money' | 'balancePercent';
export type ExitKind = 'sl' | 'tp';

type Spec = Pick<SymbolSpec, 'tickSize' | 'pointValue' | 'currency' | 'marginRate' | 'leverage' | 'qtyStep' | 'minQty' | 'symbol'>;

const EPS = 1e-9;

export function decimals(step: number): number {
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Rounds to the nearest tick and strips float noise. */
export function roundToTick(price: number, tickSize: number): number {
  const d = decimals(tickSize);
  return Number((Math.round(price / tickSize + EPS) * tickSize).toFixed(d));
}

/** Rounds quantity down to the step ("Real risk" rule: shares are always whole steps, rounded down). */
export function floorToStep(qty: number, step: number): number {
  const d = decimals(step);
  return Number((Math.floor(qty / step + EPS) * step).toFixed(d));
}

export function round2(n: number): number {
  return Math.round((n + Math.sign(n) * EPS) * 100) / 100;
}

export function sideSign(side: Side): 1 | -1 {
  return side === 'buy' ? 1 : -1;
}

export function oppositeSide(side: Side): Side {
  return side === 'buy' ? 'sell' : 'buy';
}

/**
 * Multiplier converting quote-currency amounts into the account currency (USD).
 * USD-quoted instruments → 1; USD-based pairs quoted in another currency (USDJPY) → 1 / price.
 */
export function quoteToAccountRate(spec: Pick<Spec, 'currency' | 'symbol'>, price: number): number {
  if (spec.currency === 'USD') return 1;
  if (spec.symbol.startsWith('USD') && price > 0) return 1 / price;
  return 1;
}

/** Account-currency value of a 1.0 price move for `qty` units. */
export function moneyPerPoint(qty: number, spec: Spec, price: number): number {
  return qty * spec.pointValue * quoteToAccountRate(spec, price);
}

/** Notional (trade value) in account currency. */
export function tradeValue(qty: number, price: number, spec: Spec): number {
  return qty * price * moneyPerPoint(1, spec, price);
}

export function marginRateOf(spec: Pick<Spec, 'marginRate' | 'leverage'>): number {
  return spec.leverage ? 1 / spec.leverage : spec.marginRate;
}

/** Initial margin in account currency. */
export function marginFor(qty: number, price: number, spec: Spec): number {
  return tradeValue(qty, price, spec) * marginRateOf(spec);
}

/** Account-currency value of one tick for `qty` units. */
export function tickValue(qty: number, spec: Spec, price: number): number {
  return moneyPerPoint(qty, spec, price) * spec.tickSize;
}

/** Signed P&L in account currency of moving from `entry` to `exit`. */
export function pnl(side: Side, qty: number, entry: number, exit: number, spec: Spec): number {
  return (exit - entry) * sideSign(side) * moneyPerPoint(qty, spec, exit);
}

/** Reference market price for a side: buys reference Ask, sells reference Bid. */
export function marketRef(side: Side, bid: number, ask: number): number {
  return side === 'buy' ? ask : bid;
}

/** Signed distance from the side's market reference in ticks (e.g. "Ask − 13"). */
export function offsetTicks(price: number, side: Side, bid: number, ask: number, tickSize: number): number {
  return Math.round((price - marketRef(side, bid, ask)) / tickSize);
}

export type PriceCheck = {
  /** Order would execute immediately (Buy Limit above Ask / Sell Limit below Bid). */
  fillsNow: boolean;
  /** Price is not acceptable for the order type (Buy Stop at/below Ask, Sell Stop at/above Bid). */
  invalid: boolean;
};

export function checkPrice(type: OrderType, side: Side, price: number, bid: number, ask: number): PriceCheck {
  if (type === 'market') return { fillsNow: true, invalid: false };
  if (!(price > 0)) return { fillsNow: false, invalid: true };
  if (type === 'limit') {
    const fillsNow = side === 'buy' ? price >= ask : price <= bid;
    return { fillsNow, invalid: false };
  }
  // stop
  const invalid = side === 'buy' ? price <= ask : price >= bid;
  return { fillsNow: false, invalid };
}

// ---------------------------------------------------------------------------
// Exits (stop loss / take profit)
// ---------------------------------------------------------------------------

export type ExitInput = {
  kind: ExitKind;
  /** Side of the entry order. */
  side: Side;
  entry: number;
  qty: number;
  unit: ExitUnit;
  /** Raw user value. For non-price units it is always positive; the direction comes from kind+side. */
  value: number;
  balance: number;
  spec: Spec;
};

export type ExitLevel = {
  price: number;
  /** Positive distance from entry in price units when the level is on the correct side. */
  distance: number;
  ticks: number;
  /** Distance as a percentage of entry. */
  percent: number;
  /** Signed money at the level: negative for SL, positive for TP (account currency). */
  money: number;
  /** |money| as a percentage of balance. */
  balancePercent: number;
  /** Signed price change from entry (price − entry): negative below entry, positive above. */
  delta: number;
  /** delta as a signed percentage of entry. */
  deltaPercent: number;
  /** Level is on the wrong side of entry (or non-positive). */
  invalid: boolean;
};

/** Direction from entry towards the level: SL of a buy is below entry, TP of a buy is above. */
export function exitDirection(kind: ExitKind, side: Side): 1 | -1 {
  const towardsProfit = sideSign(side);
  return kind === 'tp' ? towardsProfit : (-towardsProfit as 1 | -1);
}

/**
 * Converts an exit input in any unit into a concrete price level and all its equivalents.
 * Returns null when the input cannot be resolved (e.g. money units with zero quantity).
 */
export function resolveExit(input: ExitInput): ExitLevel | null {
  const { kind, side, entry, qty, unit, value, balance, spec } = input;
  if (!(entry > 0) || !Number.isFinite(value)) return null;
  const dir = exitDirection(kind, side);
  const perPoint = moneyPerPoint(qty, spec, entry);

  let price: number;
  switch (unit) {
    case 'price':
      price = value;
      break;
    case 'ticks':
      price = entry + dir * Math.abs(value) * spec.tickSize;
      break;
    case 'percent':
      price = entry * (1 + (dir * Math.abs(value)) / 100);
      break;
    case 'money':
    case 'balancePercent': {
      if (!(perPoint > 0)) return null;
      const money = unit === 'money' ? Math.abs(value) : (balance * Math.abs(value)) / 100;
      price = entry + (dir * money) / perPoint;
      break;
    }
  }
  price = roundToTick(price, spec.tickSize);
  return describeExit(kind, side, entry, qty, price, balance, spec);
}

/** Derives every equivalent of a concrete exit price. */
export function describeExit(kind: ExitKind, side: Side, entry: number, qty: number, price: number, balance: number, spec: Spec): ExitLevel {
  const dir = exitDirection(kind, side);
  const signedDistance = (price - entry) * dir;
  const distance = Math.abs(price - entry);
  const ticks = Math.round(distance / spec.tickSize + EPS);
  const moneyAbs = distance * moneyPerPoint(qty, spec, entry);
  const money = kind === 'sl' ? -moneyAbs : moneyAbs;
  return {
    price,
    distance,
    ticks,
    percent: entry > 0 ? (distance / entry) * 100 : 0,
    money: round2(money),
    balancePercent: balance > 0 ? (moneyAbs / balance) * 100 : 0,
    delta: Number((price - entry).toFixed(decimals(spec.tickSize))),
    deltaPercent: entry > 0 ? ((price - entry) / entry) * 100 : 0,
    invalid: !(price > 0) || signedDistance <= EPS,
  };
}

/** Default exit when a level is switched on: a percentage of entry on the correct side, rounded to tick (SL 2%, TP 4%). */
export function defaultExitPrice(kind: ExitKind, side: Side, entry: number, percent: number, tickSize: number): number {
  return roundToTick(entry * (1 + (exitDirection(kind, side) * percent) / 100), tickSize);
}

/** The positive value a level has in a given input unit (what the user would type). */
export function exitValueInUnit(level: ExitLevel, unit: ExitUnit): number {
  switch (unit) {
    case 'price':
      return level.price;
    case 'ticks':
      return level.ticks;
    case 'percent':
      return level.percent;
    case 'money':
      return Math.abs(level.money);
    case 'balancePercent':
      return level.balancePercent;
  }
}

/** Required margin exceeds what the account has available. */
export function exceedsMargin(margin: number, availableFunds: number): boolean {
  return margin > availableFunds + 1e-9;
}

/** Reward-to-risk ratio from SL and TP distances; null if not computable. */
export function riskReward(slDistance: number, tpDistance: number): number | null {
  if (!(slDistance > 0) || !(tpDistance > 0)) return null;
  return tpDistance / slDistance;
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

export type QtyInput = {
  unit: QtyUnit;
  value: number;
  /** Entry price used for value conversions. */
  price: number;
  balance: number;
  /** Stop-loss distance in price units; required for risk-based units. */
  slDistance: number | null;
  spec: Spec;
};

export type QtyResult = {
  /** Quantity in instrument units after rounding down to qtyStep. */
  qty: number;
  /** Risk modes without a stop loss cannot be resolved. */
  needsStopLoss: boolean;
};

/** Converts a quantity entered in any unit into instrument units (rounded down to the step). */
export function resolveQty(input: QtyInput): QtyResult {
  const { unit, value, price, balance, slDistance, spec } = input;
  if (!(value > 0)) return { qty: 0, needsStopLoss: false };
  const unitValue = tradeValue(1, price, spec);
  let raw: number;
  switch (unit) {
    case 'units':
      raw = value;
      break;
    case 'value':
      if (!(unitValue > 0)) return { qty: 0, needsStopLoss: false };
      raw = value / unitValue;
      break;
    case 'balancePercent':
      if (!(unitValue > 0)) return { qty: 0, needsStopLoss: false };
      raw = (balance * value) / 100 / unitValue;
      break;
    case 'riskMoney':
    case 'riskBalancePercent': {
      if (!slDistance || !(slDistance > 0)) return { qty: 0, needsStopLoss: true };
      const risk = unit === 'riskMoney' ? value : (balance * value) / 100;
      raw = risk / (slDistance * moneyPerPoint(1, spec, price));
      break;
    }
  }
  return { qty: floorToStep(raw, spec.qtyStep), needsStopLoss: false };
}

/** Expresses a quantity in every alternative unit (for the "214.12 USD ▾" style dropdowns). */
export function qtyEquivalents(qty: number, price: number, balance: number, slDistance: number | null, spec: Spec) {
  const value = tradeValue(qty, price, spec);
  const risk = slDistance && slDistance > 0 ? slDistance * moneyPerPoint(qty, spec, price) : null;
  return {
    units: qty,
    value: round2(value),
    balancePercent: balance > 0 ? (value / balance) * 100 : 0,
    riskMoney: risk === null ? null : round2(risk),
    riskBalancePercent: risk === null || !(balance > 0) ? null : (risk / balance) * 100,
  };
}

// ---------------------------------------------------------------------------
// Step 2b: price offsets, risk sizing limits, take-profit levels
// ---------------------------------------------------------------------------

/** Which way a limit/stop is "normally" placed from its reference: buy limit / sell stop below, buy stop / sell limit above. */
export function offsetDirection(type: 'limit' | 'stop', side: Side): 1 | -1 {
  const below = (type === 'limit') === (side === 'buy');
  return below ? -1 : 1;
}

/** Limit/stop price from a positive tick offset ("257 ticks below Ask"). */
export function priceFromOffset(type: 'limit' | 'stop', side: Side, bid: number, ask: number, ticks: number, tickSize: number): number {
  return roundToTick(marketRef(side, bid, ask) + offsetDirection(type, side) * Math.abs(ticks) * tickSize, tickSize);
}

/** Money at risk per 1 unit between entry and stop loss (account currency): "Risk is below 1 share (4.07 USD)". */
export function riskPerUnit(entry: number, stopLoss: number, spec: Spec): number {
  return Math.abs(entry - stopLoss) * moneyPerPoint(1, spec, entry);
}

/** Largest quantity the available margin allows: floor(available / margin of 1 unit). For AAPL at 201.57: 24,794. */
export function maxQtyForMargin(availableFunds: number, price: number, spec: Spec): number {
  const per = marginFor(1, price, spec);
  if (!(per > 0) || !(availableFunds > 0)) return 0;
  return floorToStep(availableFunds / per + 1e-9, spec.qtyStep);
}

/** Default "% of position" split when there are n take-profit levels: 100 · 50/50 · 33/33/34. */
export function defaultLevelPercents(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - base * (n - 1) : base));
}

/** Quantity of each level from its share of the position, rounded down to the step. */
export function splitQty(qty: number, percents: number[], qtyStep: number): number[] {
  return percents.map((p) => floorToStep((qty * Math.max(0, p)) / 100, qtyStep));
}

/** Weighted average of prices by weights (null when weights sum to 0). */
export function weightedAverage(prices: number[], weights: number[]): number | null {
  const w = weights.reduce((a, b) => a + b, 0);
  if (!(w > 0)) return null;
  return prices.reduce((a, p, i) => a + p * weights[i], 0) / w;
}
