import type { OrderType, Side } from '../lib/orderMath';

export type TimeInForce = 'day' | 'week' | 'month' | 'gtd';

/**
 * What every order panel variant submits. Prices are absolute; the panel is responsible
 * for converting any user unit (ticks, %, USD…) into prices and quantity via orderMath.
 */
/** One partial exit: its own quantity with its own take profit and stop loss (each leg optional). */
export type ExitLevelDraft = { qty: number; takeProfit?: number; stopLoss?: number };

export type OrderDraft = {
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  /** Required for limit orders. */
  limitPrice?: number;
  /** Required for stop orders. */
  stopPrice?: number;
  /** Bracket levels created after the entry fills. */
  takeProfit?: number;
  stopLoss?: number;
  /** Several take-profit levels (each with its own quantity). Overrides `takeProfit` when present. */
  takeProfits?: { price: number; qty: number }[];
  /**
   * Partial exits, each a TP / SL pair with its own quantity (one-cancels-other per level; the quantities may add up to
   * less than `qty`). Overrides `takeProfit`, `stopLoss` and `takeProfits` when present.
   */
  exitLevels?: ExitLevelDraft[];
  /** Market order queued until the session opens (ms). */
  activateAt?: number;
  tif: TimeInForce;
  /** GTD expiry (ms). For other TIFs the engine computes it. */
  expiresAt?: number;
};

export type OrderStatus = 'working' | 'filled' | 'cancelled' | 'expired' | 'rejected';
export type OrderRole = 'entry' | 'tp' | 'sl';

export type Order = {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  takeProfits?: { price: number; qty: number }[];
  exitLevels?: ExitLevelDraft[];
  /** Bracket legs of one partial exit share a group: only they cancel / shrink each other. */
  exitGroup?: string;
  /** Queued market order: executes at the first quote after this time. */
  activateAt?: number;
  tif: TimeInForce;
  /** null = good till cancelled (bracket legs). */
  expiresAt: number | null;
  status: OrderStatus;
  role: OrderRole;
  /** Entry order a bracket leg belongs to. */
  parentId?: string;
  /** Sibling bracket leg (one-cancels-other). */
  ocoId?: string;
  createdAt: number;
  updatedAt: number;
  filledAt?: number;
  fillPrice?: number;
  rejectReason?: string;
};

export type Position = {
  symbol: string;
  /** Signed quantity: > 0 long, < 0 short. */
  qty: number;
  avgPrice: number;
  openedAt: number;
};

export type Fill = {
  id: string;
  orderId: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  time: number;
  /** Realized P&L produced by this fill (closing part only). */
  realizedPnl: number;
};

export type EngineState = {
  initialBalance: number;
  /** initial balance + realized P&L */
  balance: number;
  realizedPnl: number;
  orders: Order[];
  positions: Record<string, Position>;
  fills: Fill[];
  seq: number;
};

export type EngineEventType = 'placed' | 'filled' | 'cancelled' | 'expired' | 'rejected' | 'modified' | 'positionClosed';

export type EngineEvent = {
  type: EngineEventType;
  time: number;
  order?: Order;
  symbol: string;
  message: string;
};

export type EngineResult = { state: EngineState; events: EngineEvent[] };

export type AccountSummary = {
  balance: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  accountMargin: number;
  ordersMargin: number;
  availableFunds: number;
};
