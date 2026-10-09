import type { OrderType, Side } from '../lib/orderMath';

export type TimeInForce = 'day' | 'week' | 'month' | 'gtd';

/**
 * What every order panel variant submits. Prices are absolute; the panel is responsible
 * for converting any user unit (ticks, %, USD…) into prices and quantity via orderMath.
 */
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
