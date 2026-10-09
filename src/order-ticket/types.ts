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
  qtyUnit: QtyUnit;
  qtyInput: string;
  sl: ExitState;
  tp: ExitState;
  tif: TimeInForce;
  /** GTD date as yyyy-mm-dd. */
  gtdDate: string;
  fillOutsideRth: boolean;
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
  value: number | null;
  /** Signed ticks from the side's reference (Ask for buys, Bid for sells). */
  offsetTicks: number | null;
  ref: 'Ask' | 'Bid';
  /** Buy Limit above Ask / Sell Limit below Bid — executes immediately. */
  fillsNow: boolean;
  /** Stop on the wrong side of the market. */
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
};

export type DisabledReason =
  'no-quote' | 'enter-quantity' | 'enter-price' | 'enter-price-and-quantity' | 'set-stop-loss' | 'invalid-price' | 'invalid-exit' | 'below-min-qty';

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
};
