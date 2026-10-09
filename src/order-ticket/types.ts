import type { TimeInForce, OrderDraft } from '../engine/types';
import type { ExitLevel, ExitUnit, OrderType, QtyUnit, Side } from '../lib/orderMath';

export type ExitState = {
  enabled: boolean;
  unit: ExitUnit;
  /** Raw text the user typed. Ignored while `touched` is false and the unit is `price`. */
  input: string;
  /** Untouched price exits follow the entry at the default tick offset (production behavior). */
  touched: boolean;
};

/** Raw user input of the order ticket. Everything else is derived. */
export type TicketState = {
  symbol: string;
  side: Side;
  type: OrderType;
  /** Limit / stop price text. */
  priceInput: string;
  /** Redesign: the price field accepts an absolute price or a positive tick offset from Ask/Bid. */
  priceUnit: PriceUnit;
  qtyUnit: QtyUnit;
  qtyInput: string;
  sl: ExitState;
  tp: ExitState;
  tif: TimeInForce;
  /** GTD date as yyyy-mm-dd. */
  gtdDate: string;
  /** GTD time as HH:MM ('' = end of day). */
  gtdTime: string;
  /** Share of the position for TP 1, in % ('' = the default split). */
  tpPercent: string;
  /** TP 2 and TP 3 (same unit as TP 1). */
  tpLevels: TpLevelState[];
  fillOutsideRth: boolean;
};

export type PriceUnit = 'price' | 'ticks';

export type TpLevelState = { input: string; percent: string };

export type TpLevelView = {
  input: string;
  level: ExitLevel | null;
  /** Share of the position, %. */
  percent: number;
  /** Quantity of this level after rounding down. */
  qty: number;
  /** Signed money of this level at its own quantity. */
  money: number | null;
  error: string | null;
};

export type ExitView = {
  enabled: boolean;
  unit: ExitUnit;
  /** Text to show in the input (derived when untouched). */
  input: string;
  level: ExitLevel | null;
  error: string | null;
};

export type PriceView = {
  unit: PriceUnit;
  value: number | null;
  /** The live reference used as placeholder for an empty field (Ask for buys, Bid for sells). */
  placeholder: number;
  /** Signed price distance from the reference (price − Ask/Bid): "Ask − 2.57". */
  offset: number | null;
  /** Normal placement side for the tick offset: buy limit / sell stop below, buy stop / sell limit above. */
  direction: 'below' | 'above';
  /** Signed ticks from the side's reference (Ask for buys, Bid for sells). */
  offsetTicks: number | null;
  ref: 'Ask' | 'Bid';
  /** Buy Limit above Ask / Sell Limit below Bid — executes immediately. */
  fillsNow: boolean;
  /** Stop on the wrong side of the market (it would trigger at once). */
  invalid: boolean;
};

export type QtyView = {
  /** Instrument units after rounding down to qtyStep. */
  units: number;
  needsStopLoss: boolean;
  /** The same quantity expressed in every unit (null when not computable). */
  equivalents: {
    units: number;
    value: number;
    balancePercent: number;
    riskMoney: number | null;
    riskBalancePercent: number | null;
  };
  tradeValue: number;
  margin: number;
  tickValue: number;
  /** Risk at the stop loss for the rounded quantity ("Real risk"). */
  realRisk: number | null;
  /** Money at risk per 1 unit (entry ↔ SL), when a valid stop exists. */
  riskPerUnit: number | null;
  /** Risk-sized quantity rounds down to zero: the risk is below one unit. */
  riskBelowOne: boolean;
  /** Largest quantity the available margin allows. */
  maxUnits: number;
};

export type DisabledReason =
  | 'no-quote'
  | 'enter-quantity'
  | 'enter-price'
  | 'enter-price-and-quantity'
  | 'set-stop-loss'
  | 'invalid-price'
  | 'invalid-exit'
  | 'below-min-qty'
  | 'risk-below-one'
  | 'not-enough-margin';

export type TicketView = {
  ready: boolean;
  bid: number;
  ask: number;
  spread: number;
  /** Entry used for exits: Ask/Bid for market (floats with the market), the price for limit/stop. */
  entry: number | null;
  price: PriceView | null;
  qty: QtyView;
  sl: ExitView;
  tp: ExitView;
  /** All take-profit levels (TP 1 first). Only meaningful when tp.enabled. */
  tpLevels: TpLevelView[];
  /** Sum of TP money over levels. */
  tpMoney: number | null;
  /** % of the position not covered by TP levels. */
  tpPercentLeft: number;
  /** R:R uses the quantity-weighted TP. */
  riskReward: number | null;
  expiresAt: number | null;
  availableFunds: number;
  /** Required margin is above available funds. Production submits anyway (engine rejects); the redesign blocks. */
  marginExceeded: boolean;
  canSubmit: boolean;
  disabledReason: DisabledReason | null;
  /** Human text for disabledReason in the production wording. */
  disabledText: string | null;
  draft: OrderDraft | null;
  /** Session is closed: market orders are queued until this time. */
  opensAt: number | null;
};
