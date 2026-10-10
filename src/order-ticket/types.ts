import type { TimeInForce, OrderDraft } from '../engine/types';
import type { ExitLevel, ExitUnit, OrderType, PriceStatus, QtyUnit, Side } from '../lib/orderMath';

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
  /** Redesign: the ⇆ in the price field switches between an absolute price and a signed price offset from Ask / Bid. */
  priceUnit: PriceUnit;
  /** Redesign: "Fills now" / "Triggers now", evaluated only on commit, side / type / symbol change and submit — not on ticks. */
  priceStatus: PriceStatus;
  qtyUnit: QtyUnit;
  qtyInput: string;
  sl: ExitState;
  tp: ExitState;
  tif: TimeInForce;
  /** GTD date as yyyy-mm-dd. */
  gtdDate: string;
  /** GTD time as HH:MM ('' = end of day). */
  gtdTime: string;
  /** Partial exits (Level 2, 3 …); Level 1 is the stop loss / take profit above and gets the remaining shares. */
  partials: PartialState[];
  fillOutsideRth: boolean;
};

export type PriceUnit = 'price' | 'offset';

/** A leg of a partial exit: empty input = no leg. */
export type PartialLeg = { unit: ExitUnit; input: string };

/** One partial exit (Level 2+): its shares (in units, or in % of the position) with its own take profit and stop loss. */
export type PartialState = { qtyInput: string; qtyUnit: 'units' | 'percent'; tp: PartialLeg; sl: PartialLeg };

export type PartialLegView = {
  level: ExitLevel | null;
  error: string | null;
};

export type PartialView = {
  /** Shares after rounding down. */
  qty: number;
  /** Share of the position, %. */
  percent: number;
  qtyError: string | null;
  tp: PartialLegView;
  sl: PartialLegView;
};

export type ExitView = {
  enabled: boolean;
  unit: ExitUnit;
  /** Text to show in the input (derived when untouched). */
  input: string;
  level: ExitLevel | null;
  error: string | null;
  /**
   * Redesign: what an empty or switched-off field shows in grey, as input text in the current unit — the last value,
   * else the default (SL −2% / TP +4% from entry). '' when it cannot be computed (money units without quantity).
   */
  placeholder: string;
  /** The level the placeholder stands for (grey money on the right of a switched-off field). */
  placeholderLevel: ExitLevel | null;
};

export type PriceView = {
  unit: PriceUnit;
  value: number | null;
  /** Default price (grey in an empty field): Ask / Bid moved 1% (Limit) / 1.5% (Stop) away, on a round step (199.00 at Ask 201.57). */
  placeholder: number;
  /** Signed price distance from the reference (price − Ask/Bid): "Ask − 2.57". */
  offset: number | null;
  /** Normal placement side for the offset: buy limit / sell stop below, buy stop / sell limit above. */
  direction: 'below' | 'above';
  /** Signed ticks from the side's reference (Ask for buys, Bid for sells). */
  offsetTicks: number | null;
  ref: 'Ask' | 'Bid';
  /** Buy Limit above Ask / Sell Limit below Bid — executes immediately. */
  fillsNow: boolean;
  /** Stop on the wrong side of the market (it would trigger at once). */
  invalid: boolean;
  /** The redesign's "Fills now" / "Triggers now" warning: the status from the last commit (TicketState.priceStatus). */
  status: PriceStatus;
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
  /** Risk at the stop loss for the rounded quantity (the actual risk; the redesign shows it only on the SL field and in the summary). */
  realRisk: number | null;
  /** Money at risk per 1 unit (entry ↔ SL), when a valid stop exists. */
  riskPerUnit: number | null;
  /** Risk-sized quantity rounds down to zero: the risk is below one unit. */
  riskBelowOne: boolean;
  /** Largest quantity the available margin allows. */
  maxUnits: number;
  /** The symbol's minimum quantity in every unit: the grey placeholder of an empty quantity field (null without a price). */
  placeholder: {
    units: number;
    value: number;
    balancePercent: number;
    /** Risk of the minimum quantity at the current stop loss; null without a valid stop loss. */
    riskMoney: number | null;
    riskBalancePercent: number | null;
  } | null;
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
  /** Level 1's shares: the quantity minus the partial exits. */
  level1Qty: number;
  /** Partial exits (Level 2+), in order. */
  partials: PartialView[];
  /** First problem of the partial exits (also blocks submit), else null. */
  partialsError: string | null;
  /** Share of the position covered by a stop loss, %. */
  protectedPercent: number;
  /** Total loss at the stops (negative) and profit at the take profits over all levels; null without any. */
  slMoney: number | null;
  tpMoney: number | null;
  /** Total reward / total risk over all levels; null unless every level has both legs. */
  riskReward: number | null;
  expiresAt: number | null;
  availableFunds: number;
  /** Account balance behind the "% balance" units. */
  balance: number;
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
