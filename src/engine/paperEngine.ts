/**
 * Paper trading engine — pure functions over EngineState. No UI, no timers, no storage:
 * time and quotes are always passed in, every call returns a new state plus events.
 */
import { getSpec } from '../config/symbols';
import { fmtPrice, fmtQty } from '../lib/format';
import { checkPrice, floorToStep, marginFor, oppositeSide, pnl, round2, roundToTick, sideSign, type Side } from '../lib/orderMath';
import type { Quote } from '../market/types';
import type { AccountSummary, EngineEvent, EngineResult, EngineState, Fill, Order, OrderDraft, Position, TimeInForce } from './types';

export const INITIAL_BALANCE = 100_000;

export function createEngineState(initialBalance = INITIAL_BALANCE): EngineState {
  return { initialBalance, balance: initialBalance, realizedPnl: 0, orders: [], positions: {}, fills: [], seq: 1 };
}

export type Quotes = Record<string, Quote | undefined>;

// ---------------------------------------------------------------------------
// Time in force
// ---------------------------------------------------------------------------

function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Test-only shortening of order lifetimes (?expireFast=1): Day = 1 min, Week = 3 min, Month = 10 min.
 * Set once at startup; null keeps calendar semantics.
 */
export const expiryOverride: { ms: Partial<Record<TimeInForce, number>> | null } = { ms: null };

/**
 * Day → end of today; Week → +7 days; Month → +1 calendar month (all to 23:59:59 local).
 * GTD → the chosen moment; a date at local midnight means the end of that day.
 */
export function computeExpiry(tif: TimeInForce, now: number, gtd?: number): number {
  const fast = expiryOverride.ms?.[tif];
  if (fast !== undefined) return now + fast;
  switch (tif) {
    case 'day':
      return endOfDay(now);
    case 'week':
      return endOfDay(now + 7 * 86_400_000);
    case 'month': {
      const d = new Date(now);
      d.setMonth(d.getMonth() + 1);
      return endOfDay(d.getTime());
    }
    case 'gtd': {
      const t = gtd ?? now;
      const d = new Date(t);
      return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 ? endOfDay(t) : t;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sideLabel(side: Side) {
  return side === 'buy' ? 'Buy' : 'Sell';
}

function typeLabel(o: Pick<Order, 'type' | 'role'>) {
  if (o.role === 'tp') return 'Take profit';
  if (o.role === 'sl') return 'Stop loss';
  return o.type === 'market' ? 'Market' : o.type === 'limit' ? 'Limit' : 'Stop';
}

function orderPrice(o: Pick<Order, 'type' | 'limitPrice' | 'stopPrice'>): number | undefined {
  return o.type === 'limit' ? o.limitPrice : o.type === 'stop' ? o.stopPrice : undefined;
}

function describe(o: Order): string {
  const spec = getSpec(o.symbol);
  const px = orderPrice(o);
  return `${sideLabel(o.side)} ${fmtQty(o.qty, spec)} ${o.symbol}${px !== undefined ? ` @ ${fmtPrice(px, spec)}` : ''} ${typeLabel(o)}`;
}

function nextId(state: EngineState): [string, EngineState] {
  return [String(state.seq), { ...state, seq: state.seq + 1 }];
}

function replaceOrder(state: EngineState, order: Order): EngineState {
  return { ...state, orders: state.orders.map((o) => (o.id === order.id ? order : o)) };
}

function ev(type: EngineEvent['type'], time: number, symbol: string, message: string, order?: Order): EngineEvent {
  return { type, time, symbol, message, order };
}

function reject(state: EngineState, draft: OrderDraft, reason: string, now: number): EngineResult {
  const [id, s] = nextId(state);
  const order: Order = {
    id,
    symbol: draft.symbol,
    side: draft.side,
    type: draft.type,
    qty: draft.qty,
    limitPrice: draft.limitPrice,
    stopPrice: draft.stopPrice,
    takeProfit: draft.takeProfit,
    stopLoss: draft.stopLoss,
    tif: draft.tif,
    expiresAt: null,
    status: 'rejected',
    role: 'entry',
    createdAt: now,
    updatedAt: now,
    rejectReason: reason,
  };
  return { state: { ...s, orders: [...s.orders, order] }, events: [ev('rejected', now, draft.symbol, `Order rejected: ${reason}`, order)] };
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/** Price a position would be closed at: longs exit on Bid, shorts on Ask. */
function markPrice(pos: Position, q: Quote | undefined): number {
  if (!q) return pos.avgPrice;
  return pos.qty > 0 ? q.bid : q.ask;
}

export function unrealizedPnl(pos: Position, q: Quote | undefined): number {
  const side: Side = pos.qty > 0 ? 'buy' : 'sell';
  return pnl(side, Math.abs(pos.qty), pos.avgPrice, markPrice(pos, q), getSpec(pos.symbol));
}

export function accountSummary(state: EngineState, quotes: Quotes): AccountSummary {
  let unrealized = 0;
  let accountMargin = 0;
  for (const pos of Object.values(state.positions)) {
    const q = quotes[pos.symbol];
    unrealized += unrealizedPnl(pos, q);
    accountMargin += marginFor(Math.abs(pos.qty), markPrice(pos, q), getSpec(pos.symbol));
  }
  let ordersMargin = 0;
  for (const o of state.orders) {
    if (o.status !== 'working' || o.role !== 'entry') continue;
    const q = quotes[o.symbol];
    const px = orderPrice(o) ?? (q ? (o.side === 'buy' ? q.ask : q.bid) : 0);
    ordersMargin += marginFor(o.qty, px, getSpec(o.symbol));
  }
  const equity = state.balance + unrealized;
  return {
    balance: round2(state.balance),
    equity: round2(equity),
    realizedPnl: round2(state.realizedPnl),
    unrealizedPnl: round2(unrealized),
    accountMargin: round2(accountMargin),
    ordersMargin: round2(ordersMargin),
    availableFunds: round2(equity - accountMargin - ordersMargin),
  };
}

/** Margin an order would add: only the part that increases the absolute position. */
function incrementalMargin(state: EngineState, symbol: string, side: Side, qty: number, price: number): number {
  const cur = state.positions[symbol]?.qty ?? 0;
  const next = cur + sideSign(side) * qty;
  const increase = Math.max(0, Math.abs(next) - Math.abs(cur));
  return marginFor(increase, price, getSpec(symbol));
}

// ---------------------------------------------------------------------------
// Fills and positions
// ---------------------------------------------------------------------------

function applyFill(state: EngineState, order: Order, price: number, now: number): EngineResult {
  const spec = getSpec(order.symbol);
  const events: EngineEvent[] = [];
  const signed = sideSign(order.side) * order.qty;
  const prev = state.positions[order.symbol];
  const positions = { ...state.positions };
  let realized = 0;

  if (!prev || prev.qty === 0) {
    positions[order.symbol] = { symbol: order.symbol, qty: signed, avgPrice: price, openedAt: now };
  } else if (Math.sign(prev.qty) === Math.sign(signed)) {
    const qty = prev.qty + signed;
    const avgPrice = (prev.avgPrice * Math.abs(prev.qty) + price * order.qty) / Math.abs(qty);
    positions[order.symbol] = { ...prev, qty, avgPrice };
  } else {
    const closing = Math.min(Math.abs(prev.qty), order.qty);
    realized = pnl(prev.qty > 0 ? 'buy' : 'sell', closing, prev.avgPrice, price, spec);
    const qty = Number((prev.qty + signed).toFixed(10));
    if (qty === 0) delete positions[order.symbol];
    else if (Math.sign(qty) === Math.sign(prev.qty)) positions[order.symbol] = { ...prev, qty };
    else positions[order.symbol] = { symbol: order.symbol, qty, avgPrice: price, openedAt: now };
  }

  const filled: Order = { ...order, status: 'filled', fillPrice: price, filledAt: now, updatedAt: now };
  let [fillId, s] = nextId(state);
  const fill: Fill = { id: fillId, orderId: order.id, symbol: order.symbol, side: order.side, qty: order.qty, price, time: now, realizedPnl: round2(realized) };
  s = {
    ...replaceOrder(s, filled),
    positions,
    fills: [...s.fills, fill],
    realizedPnl: s.realizedPnl + realized,
    balance: s.balance + realized,
  };
  events.push(
    ev('filled', now, order.symbol, `Order executed: ${sideLabel(order.side)} ${fmtQty(order.qty, spec)} ${order.symbol} at ${fmtPrice(price, spec)}`, filled),
  );

  // Bracket legs of the same entry: SL cancels every TP; a TP shrinks the SL by its quantity.
  if (order.parentId && (order.role === 'sl' || order.role === 'tp')) {
    for (const leg of s.orders.filter((o) => o.parentId === order.parentId && o.status === 'working' && o.id !== order.id)) {
      if (order.role === 'sl' || (leg.role === 'sl' && leg.qty - order.qty <= 1e-9)) {
        const cancelled: Order = { ...leg, status: 'cancelled', updatedAt: now };
        s = replaceOrder(s, cancelled);
        events.push(ev('cancelled', now, leg.symbol, `Order cancelled: ${describe(leg)}`, cancelled));
      } else if (leg.role === 'sl') {
        const reduced: Order = { ...leg, qty: Number((leg.qty - order.qty).toFixed(10)), updatedAt: now };
        s = replaceOrder(s, reduced);
        events.push(ev('modified', now, leg.symbol, `Order modified: ${describe(reduced)}`, reduced));
      }
    }
  }

  // Entry with exits → create the bracket legs.
  const tps = order.takeProfits?.length ? order.takeProfits : order.takeProfit !== undefined ? [{ price: order.takeProfit, qty: order.qty }] : [];
  if (order.role === 'entry' && (tps.length > 0 || order.stopLoss !== undefined)) {
    const legs: Order[] = [];
    const exitSide = oppositeSide(order.side);
    const base = {
      symbol: order.symbol,
      side: exitSide,
      tif: order.tif,
      expiresAt: null,
      status: 'working' as const,
      parentId: order.id,
      createdAt: now,
      updatedAt: now,
    };
    const tpIds: string[] = [];
    for (const tp of tps) {
      if (!(tp.qty > 0)) continue;
      let id: string;
      [id, s] = nextId(s);
      tpIds.push(id);
      legs.push({ ...base, id, qty: tp.qty, type: 'limit', limitPrice: tp.price, role: 'tp' });
    }
    let slId: string | undefined;
    if (order.stopLoss !== undefined) {
      [slId, s] = nextId(s);
      legs.push({ ...base, id: slId, qty: order.qty, type: 'stop', stopPrice: order.stopLoss, role: 'sl' });
    }
    // Single TP + SL keep the classic OCO pair link.
    if (tpIds.length === 1 && slId) {
      legs[0].ocoId = slId;
      legs[1].ocoId = tpIds[0];
    }
    s = { ...s, orders: [...s.orders, ...legs] };
    legs.forEach((l) => events.push(ev('placed', now, l.symbol, `Order placed: ${describe(l)}`, l)));
  }

  // A flat position leaves no reason for remaining bracket legs.
  if (!s.positions[order.symbol]) {
    const r = cancelBrackets(s, order.symbol, now);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

function cancelBrackets(state: EngineState, symbol: string, now: number): EngineResult {
  const events: EngineEvent[] = [];
  const orders = state.orders.map((o) => {
    if (o.symbol !== symbol || o.status !== 'working' || o.role === 'entry') return o;
    const c: Order = { ...o, status: 'cancelled', updatedAt: now };
    events.push(ev('cancelled', now, symbol, `Order cancelled: ${describe(o)}`, c));
    return c;
  });
  return { state: { ...state, orders }, events };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(state: EngineState, draft: OrderDraft, quotes: Quotes, now: number): string | null {
  const spec = getSpec(draft.symbol);
  const q = quotes[draft.symbol];
  if (!q) return 'No market data';
  if (!(draft.qty > 0)) return 'Quantity must be greater than zero';
  if (draft.qty < spec.minQty - 1e-12) return `Minimum quantity is ${spec.minQty}`;
  if (Math.abs(floorToStep(draft.qty, spec.qtyStep) - draft.qty) > 1e-9) return `Quantity must be a multiple of ${spec.qtyStep}`;
  if (draft.type === 'limit' && !(draft.limitPrice && draft.limitPrice > 0)) return 'Limit price is required';
  if (draft.type === 'stop' && !(draft.stopPrice && draft.stopPrice > 0)) return 'Stop price is required';
  if (draft.tif === 'gtd' && !(draft.expiresAt && draft.expiresAt > now)) return 'Expiration date must be in the future';

  const entry = draft.type === 'limit' ? draft.limitPrice! : draft.type === 'stop' ? draft.stopPrice! : draft.side === 'buy' ? q.ask : q.bid;
  const dir = sideSign(draft.side);
  if (draft.stopLoss !== undefined && !((entry - draft.stopLoss) * dir > 0)) return `Stop loss must be ${draft.side === 'buy' ? 'below' : 'above'} entry price`;
  if (draft.takeProfit !== undefined && !((draft.takeProfit - entry) * dir > 0))
    return `Take profit must be ${draft.side === 'buy' ? 'above' : 'below'} entry price`;
  if (draft.takeProfits?.some((t) => !((t.price - entry) * dir > 0))) return `Take profit must be ${draft.side === 'buy' ? 'above' : 'below'} entry price`;
  if (draft.takeProfits && draft.takeProfits.reduce((a, t) => a + t.qty, 0) > draft.qty + 1e-9) return 'Take profit levels exceed the position size';

  const required = incrementalMargin(state, draft.symbol, draft.side, draft.qty, entry);
  const available = accountSummary(state, quotes).availableFunds;
  if (required > available + 1e-9) return `Insufficient funds: margin ${round2(required)} USD, available ${round2(available)} USD`;
  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function placeOrder(state: EngineState, draft: OrderDraft, quotes: Quotes, now: number): EngineResult {
  const error = validate(state, draft, quotes, now);
  if (error) return reject(state, draft, error, now);
  const q = quotes[draft.symbol]!;

  const [id, s0] = nextId(state);
  const order: Order = {
    id,
    symbol: draft.symbol,
    side: draft.side,
    type: draft.type,
    qty: draft.qty,
    limitPrice: draft.type === 'limit' ? draft.limitPrice : undefined,
    stopPrice: draft.type === 'stop' ? draft.stopPrice : undefined,
    takeProfit: draft.takeProfit,
    stopLoss: draft.stopLoss,
    takeProfits: draft.takeProfits,
    activateAt: draft.type === 'market' ? draft.activateAt : undefined,
    tif: draft.tif,
    expiresAt: draft.type === 'market' ? null : computeExpiry(draft.tif, now, draft.expiresAt),
    status: 'working',
    role: 'entry',
    createdAt: now,
    updatedAt: now,
  };
  let s: EngineState = { ...s0, orders: [...s0.orders, order] };
  const events: EngineEvent[] = [ev('placed', now, order.symbol, `Order placed: ${describe(order)}`, order)];

  // Market, marketable limits and already-triggered stops execute immediately at the touch (Buy at Ask, Sell at Bid).
  // A market order queued for the session open waits for onQuote.
  const queued = order.activateAt !== undefined && order.activateAt > now;
  const marketable =
    (draft.type === 'market' && !queued) ||
    (draft.type === 'limit' && checkPrice('limit', draft.side, draft.limitPrice!, q.bid, q.ask).fillsNow) ||
    (draft.type === 'stop' && checkPrice('stop', draft.side, draft.stopPrice!, q.bid, q.ask).invalid);
  if (marketable) {
    const r = applyFill(s, order, draft.side === 'buy' ? q.ask : q.bid, now);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Matches working orders of the quote's symbol. Resting limits fill at their price, stops at the touch. */
export function onQuote(state: EngineState, quote: Quote, now: number): EngineResult {
  let s = state;
  const events: EngineEvent[] = [];
  const candidates = s.orders.filter((o) => o.symbol === quote.symbol && o.status === 'working');
  for (const c of candidates) {
    const o = s.orders.find((x) => x.id === c.id);
    if (!o || o.status !== 'working') continue; // cancelled by an earlier OCO fill in this pass
    let price: number | null = null;
    if (o.type === 'market') {
      if (o.activateAt === undefined || now >= o.activateAt) price = o.side === 'buy' ? quote.ask : quote.bid;
    } else if (o.type === 'limit') {
      if (o.side === 'buy' && quote.ask <= o.limitPrice!) price = o.limitPrice!;
      if (o.side === 'sell' && quote.bid >= o.limitPrice!) price = o.limitPrice!;
    } else if (o.type === 'stop') {
      if (o.side === 'buy' && quote.ask >= o.stopPrice!) price = quote.ask;
      if (o.side === 'sell' && quote.bid <= o.stopPrice!) price = quote.bid;
    }
    if (price === null) continue;
    const r = applyFill(s, o, price, now);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

export function expireOrders(state: EngineState, now: number): EngineResult {
  const events: EngineEvent[] = [];
  let changed = false;
  const orders = state.orders.map((o) => {
    if (o.status !== 'working' || o.expiresAt === null || o.expiresAt > now) return o;
    changed = true;
    const x: Order = { ...o, status: 'expired', updatedAt: now };
    events.push(ev('expired', now, o.symbol, `Order expired: ${describe(o)}`, x));
    return x;
  });
  return { state: changed ? { ...state, orders } : state, events };
}

export function cancelOrder(state: EngineState, id: string, now: number): EngineResult {
  const o = state.orders.find((x) => x.id === id);
  if (!o || o.status !== 'working') return { state, events: [] };
  const c: Order = { ...o, status: 'cancelled', updatedAt: now };
  // The surviving leg no longer has an OCO partner.
  let s = replaceOrder(state, c);
  if (o.ocoId) {
    const sib = s.orders.find((x) => x.id === o.ocoId);
    if (sib) s = replaceOrder(s, { ...sib, ocoId: undefined });
  }
  return { state: s, events: [ev('cancelled', now, o.symbol, `Order cancelled: ${describe(o)}`, c)] };
}

export type OrderPatch = Partial<Pick<Order, 'qty' | 'limitPrice' | 'stopPrice' | 'takeProfit' | 'stopLoss'>>;

/** Modifies a working order and immediately re-matches it against the current quote. */
export function modifyOrder(state: EngineState, id: string, patch: OrderPatch, quotes: Quotes, now: number): EngineResult {
  const o = state.orders.find((x) => x.id === id);
  if (!o || o.status !== 'working') return { state, events: [] };
  const spec = getSpec(o.symbol);
  const q = quotes[o.symbol];
  const next: Order = { ...o, ...patch, updatedAt: now };
  // Moving an entry carries its exits along at the same distance (like dragging the order line).
  const oldPx = orderPrice(o);
  const newPx = orderPrice(next);
  if (o.role === 'entry' && oldPx !== undefined && newPx !== undefined && newPx !== oldPx) {
    const delta = newPx - oldPx;
    if (o.takeProfit !== undefined && patch.takeProfit === undefined) next.takeProfit = roundToTick(o.takeProfit + delta, spec.tickSize);
    if (o.stopLoss !== undefined && patch.stopLoss === undefined) next.stopLoss = roundToTick(o.stopLoss + delta, spec.tickSize);
  }
  const fail = (msg: string): EngineResult => ({ state, events: [ev('rejected', now, o.symbol, `Modify rejected: ${msg}`, o)] });
  if (!(next.qty >= spec.minQty) || Math.abs(floorToStep(next.qty, spec.qtyStep) - next.qty) > 1e-9) return fail('invalid quantity');
  if (next.type === 'limit' && !(next.limitPrice! > 0)) return fail('invalid limit price');
  if (next.type === 'stop' && !(next.stopPrice! > 0)) return fail('invalid stop price');
  if (q && next.type === 'stop' && next.role === 'entry' && checkPrice('stop', next.side, next.stopPrice!, q.bid, q.ask).invalid)
    return fail(next.side === 'buy' ? 'stop price must be above Ask' : 'stop price must be below Bid');
  const s = replaceOrder(state, next);
  const events = [ev('modified', now, o.symbol, `Order modified: ${describe(next)}`, next)];
  if (!q) return { state: s, events };
  if (next.type === 'limit' && next.role === 'entry' && checkPrice('limit', next.side, next.limitPrice!, q.bid, q.ask).fillsNow) {
    const r = applyFill(s, next, next.side === 'buy' ? q.ask : q.bid, now);
    return { state: r.state, events: [...events, ...r.events] };
  }
  const r = onQuote(s, q, now);
  return { state: r.state, events: [...events, ...r.events] };
}

/** Closes the whole position at market and cancels its bracket legs. */
export function closePosition(state: EngineState, symbol: string, quotes: Quotes, now: number): EngineResult {
  const pos = state.positions[symbol];
  const q = quotes[symbol];
  if (!pos || !q) return { state, events: [] };
  const side: Side = pos.qty > 0 ? 'sell' : 'buy';
  const [id, s0] = nextId(state);
  const order: Order = {
    id,
    symbol,
    side,
    type: 'market',
    qty: Math.abs(pos.qty),
    tif: 'day',
    expiresAt: null,
    status: 'working',
    role: 'entry',
    createdAt: now,
    updatedAt: now,
  };
  const r = applyFill({ ...s0, orders: [...s0.orders, order] }, order, side === 'buy' ? q.ask : q.bid, now);
  const spec = getSpec(symbol);
  const realized = r.state.fills[r.state.fills.length - 1]?.realizedPnl ?? 0;
  return {
    state: r.state,
    events: [
      ...r.events,
      ev(
        'positionClosed',
        now,
        symbol,
        `Position closed: ${symbol} ${fmtQty(Math.abs(pos.qty), spec)}, P&L ${realized >= 0 ? '+' : ''}${realized.toFixed(2)} USD`,
      ),
    ],
  };
}
