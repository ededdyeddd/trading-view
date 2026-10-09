import { describe, expect, it } from 'vitest';
import type { Quote } from '../market/types';
import {
  accountSummary,
  cancelOrder,
  closePosition,
  computeExpiry,
  createEngineState,
  expireOrders,
  modifyOrder,
  onQuote,
  placeOrder,
  type Quotes,
} from './paperEngine';
import type { EngineState, OrderDraft } from './types';

const T0 = new Date(2026, 9, 9, 12, 0, 0).getTime();

function q(bid: number, ask: number, symbol = 'AAPL'): Quote {
  return { symbol, bid, ask, last: bid, ts: T0 };
}

const AAPL = q(201.56, 201.57);
const quotes = (...list: Quote[]): Quotes => Object.fromEntries(list.map((x) => [x.symbol, x]));

function draft(p: Partial<OrderDraft> = {}): OrderDraft {
  return { symbol: 'AAPL', side: 'buy', type: 'market', qty: 100, tif: 'week', ...p };
}

function working(s: EngineState) {
  return s.orders.filter((o) => o.status === 'working');
}

describe('account', () => {
  it('starts at 100,000 USD with no exposure', () => {
    const s = createEngineState();
    expect(accountSummary(s, {})).toEqual({
      balance: 100_000,
      equity: 100_000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      accountMargin: 0,
      ordersMargin: 0,
      availableFunds: 100_000,
    });
  });
});

describe('market orders', () => {
  it('buy fills at Ask, sell fills at Bid', () => {
    let r = placeOrder(createEngineState(), draft(), quotes(AAPL), T0);
    expect(r.state.positions.AAPL).toMatchObject({ qty: 100, avgPrice: 201.57 });
    expect(r.events.map((e) => e.type)).toEqual(['placed', 'filled']);

    r = placeOrder(createEngineState(), draft({ side: 'sell' }), quotes(AAPL), T0);
    expect(r.state.positions.AAPL).toMatchObject({ qty: -100, avgPrice: 201.56 });
  });

  it('marks unrealized P&L at the exit side and uses 2% margin for stocks', () => {
    const { state } = placeOrder(createEngineState(), draft(), quotes(AAPL), T0);
    const sum = accountSummary(state, quotes(q(202.56, 202.57)));
    expect(sum.unrealizedPnl).toBe(99); // (202.56 − 201.57) × 100
    expect(sum.accountMargin).toBeCloseTo(405.12, 2); // 100 × 202.56 × 2%
    expect(sum.equity).toBe(100_099);
    expect(sum.availableFunds).toBeCloseTo(100_099 - 405.12, 2);
  });

  it('averages into a position and realizes P&L on reduction', () => {
    let s = placeOrder(createEngineState(), draft({ qty: 100 }), quotes(q(200, 200.01)), T0).state;
    s = placeOrder(s, draft({ qty: 100 }), quotes(q(202, 202.01)), T0).state;
    expect(s.positions.AAPL.avgPrice).toBeCloseTo(201.01, 6);
    s = placeOrder(s, draft({ side: 'sell', qty: 50 }), quotes(q(203.01, 203.02)), T0).state;
    expect(s.positions.AAPL.qty).toBe(150);
    expect(s.realizedPnl).toBeCloseTo(100, 6); // (203.01 − 201.01) × 50
    expect(s.balance).toBeCloseTo(100_100, 6);
  });

  it('flips a position when the opposite fill is larger', () => {
    let s = placeOrder(createEngineState(), draft({ qty: 10 }), quotes(q(100, 100.01)), T0).state;
    s = placeOrder(s, draft({ side: 'sell', qty: 30 }), quotes(q(101, 101.01)), T0).state;
    expect(s.positions.AAPL).toMatchObject({ qty: -20, avgPrice: 101 });
    expect(s.realizedPnl).toBeCloseTo(9.9, 6);
  });

  it('rejects orders above available funds', () => {
    const r = placeOrder(createEngineState(), draft({ qty: 30_000 }), quotes(AAPL), T0); // 6.05M notional, 121k margin
    expect(r.events[0].type).toBe('rejected');
    expect(r.state.positions.AAPL).toBeUndefined();
  });

  it('crypto margin uses symbol leverage', () => {
    const btc = q(80_000, 80_000.01, 'BTCUSDT');
    const { state } = placeOrder(createEngineState(), draft({ symbol: 'BTCUSDT', qty: 1 }), quotes(btc), T0);
    expect(accountSummary(state, quotes(btc)).accountMargin).toBeCloseTo(40_000, 0);
  });
});

describe('limit orders', () => {
  it('buy limit below Ask rests and fills when Ask ≤ limit (at the limit price)', () => {
    let r = placeOrder(createEngineState(), draft({ type: 'limit', limitPrice: 200 }), quotes(AAPL), T0);
    expect(working(r.state)).toHaveLength(1);
    r = onQuote(r.state, q(200.5, 200.51), T0);
    expect(r.events).toHaveLength(0);
    r = onQuote(r.state, q(199.98, 199.99), T0);
    expect(r.state.positions.AAPL).toMatchObject({ qty: 100, avgPrice: 200 });
    expect(r.events[0].type).toBe('filled');
  });

  it('buy limit above Ask fills immediately at Ask (production behavior)', () => {
    const r = placeOrder(createEngineState(), draft({ type: 'limit', limitPrice: 201.64 }), quotes(AAPL), T0);
    expect(r.state.positions.AAPL).toMatchObject({ qty: 100, avgPrice: 201.57 });
    expect(working(r.state)).toHaveLength(0);
  });

  it('sell limit fills when Bid ≥ limit', () => {
    let s = placeOrder(createEngineState(), draft({ side: 'sell', type: 'limit', limitPrice: 203 }), quotes(AAPL), T0).state;
    s = onQuote(s, q(202.99, 203), T0).state;
    expect(s.positions.AAPL).toBeUndefined();
    s = onQuote(s, q(203, 203.01), T0).state;
    expect(s.positions.AAPL).toMatchObject({ qty: -100, avgPrice: 203 });
  });

  it('working entry orders reserve orders margin', () => {
    const { state } = placeOrder(createEngineState(), draft({ type: 'limit', limitPrice: 200 }), quotes(AAPL), T0);
    expect(accountSummary(state, quotes(AAPL)).ordersMargin).toBe(400);
  });
});

describe('stop orders', () => {
  it('buy stop triggers when Ask ≥ stop and fills at Ask', () => {
    let s = placeOrder(createEngineState(), draft({ type: 'stop', stopPrice: 202 }), quotes(AAPL), T0).state;
    s = onQuote(s, q(201.98, 201.99), T0).state;
    expect(s.positions.AAPL).toBeUndefined();
    s = onQuote(s, q(202.02, 202.03), T0).state;
    expect(s.positions.AAPL).toMatchObject({ qty: 100, avgPrice: 202.03 });
  });

  it('sell stop triggers when Bid ≤ stop', () => {
    let s = placeOrder(createEngineState(), draft({ side: 'sell', type: 'stop', stopPrice: 201 }), quotes(AAPL), T0).state;
    s = onQuote(s, q(200.99, 201), T0).state;
    expect(s.positions.AAPL).toMatchObject({ qty: -100, avgPrice: 200.99 });
  });

  it('rejects a buy stop at or below Ask', () => {
    const r = placeOrder(createEngineState(), draft({ type: 'stop', stopPrice: 201.5 }), quotes(AAPL), T0);
    expect(r.events[0]).toMatchObject({ type: 'rejected' });
  });
});

describe('brackets (SL / TP)', () => {
  it('creates OCO legs after the entry fills; TP fill cancels SL', () => {
    let r = placeOrder(createEngineState(), draft({ takeProfit: 211, stopLoss: 197.5 }), quotes(AAPL), T0);
    const legs = working(r.state);
    expect(legs.map((o) => [o.role, o.side, o.type, o.limitPrice ?? o.stopPrice])).toEqual([
      ['tp', 'sell', 'limit', 211],
      ['sl', 'sell', 'stop', 197.5],
    ]);
    expect(legs[0].ocoId).toBe(legs[1].id);

    r = onQuote(r.state, q(211, 211.01), T0);
    expect(r.state.positions.AAPL).toBeUndefined();
    expect(r.state.realizedPnl).toBeCloseTo(943, 6); // (211 − 201.57) × 100
    expect(working(r.state)).toHaveLength(0);
    expect(r.events.map((e) => e.type)).toEqual(['filled', 'cancelled']);
  });

  it('SL fill cancels TP', () => {
    let s = placeOrder(createEngineState(), draft({ takeProfit: 211, stopLoss: 197.5 }), quotes(AAPL), T0).state;
    s = onQuote(s, q(197.49, 197.5), T0).state;
    expect(s.realizedPnl).toBeCloseTo(-408, 6); // filled at Bid 197.49
    expect(working(s)).toHaveLength(0);
  });

  it('a limit entry creates legs only after it fills', () => {
    let s = placeOrder(createEngineState(), draft({ type: 'limit', limitPrice: 200, stopLoss: 198, takeProfit: 205 }), quotes(AAPL), T0).state;
    expect(working(s).map((o) => o.role)).toEqual(['entry']);
    s = onQuote(s, q(199.99, 200), T0).state;
    expect(working(s).map((o) => o.role)).toEqual(['tp', 'sl']);
  });

  it('rejects exits on the wrong side of entry', () => {
    expect(placeOrder(createEngineState(), draft({ stopLoss: 205 }), quotes(AAPL), T0).events[0].type).toBe('rejected');
    expect(placeOrder(createEngineState(), draft({ takeProfit: 199 }), quotes(AAPL), T0).events[0].type).toBe('rejected');
  });

  it('closing the position cancels its legs and realizes P&L', () => {
    let s = placeOrder(createEngineState(), draft({ takeProfit: 211, stopLoss: 197.5 }), quotes(AAPL), T0).state;
    const r = closePosition(s, 'AAPL', quotes(q(202.56, 202.57)), T0);
    s = r.state;
    expect(s.positions.AAPL).toBeUndefined();
    expect(s.realizedPnl).toBeCloseTo(99, 6);
    expect(working(s)).toHaveLength(0);
    expect(r.events.at(-1)?.type).toBe('positionClosed');
  });
});

describe('time in force', () => {
  it('computes expiry for Day / Week / Month / GTD', () => {
    const endOf = (d: Date) => (d.setHours(23, 59, 59, 999), d.getTime());
    expect(computeExpiry('day', T0)).toBe(endOf(new Date(2026, 9, 9)));
    expect(computeExpiry('week', T0)).toBe(endOf(new Date(2026, 9, 16)));
    expect(computeExpiry('month', T0)).toBe(endOf(new Date(2026, 10, 9)));
    expect(computeExpiry('gtd', T0, new Date(2026, 9, 20).getTime())).toBe(endOf(new Date(2026, 9, 20)));
  });

  it('expired orders move to history with status Expired', () => {
    let s = placeOrder(createEngineState(), draft({ type: 'limit', limitPrice: 190, tif: 'day' }), quotes(AAPL), T0).state;
    let r = expireOrders(s, T0 + 3600_000);
    expect(r.events).toHaveLength(0);
    r = expireOrders(s, T0 + 86_400_000);
    s = r.state;
    expect(s.orders[0].status).toBe('expired');
    expect(r.events[0].type).toBe('expired');
  });

  it('bracket legs do not expire', () => {
    const s = placeOrder(createEngineState(), draft({ stopLoss: 190, tif: 'day' }), quotes(AAPL), T0).state;
    expect(working(expireOrders(s, T0 + 30 * 86_400_000).state)).toHaveLength(1);
  });
});

describe('cancel / modify', () => {
  it('cancels a working order', () => {
    let s = placeOrder(createEngineState(), draft({ type: 'limit', limitPrice: 190 }), quotes(AAPL), T0).state;
    const r = cancelOrder(s, s.orders[0].id, T0);
    s = r.state;
    expect(s.orders[0].status).toBe('cancelled');
    expect(r.events[0].type).toBe('cancelled');
    expect(cancelOrder(s, s.orders[0].id, T0).events).toHaveLength(0);
  });

  it('modifies price and quantity; a marketable modify fills immediately', () => {
    let s = placeOrder(createEngineState(), draft({ type: 'limit', limitPrice: 190 }), quotes(AAPL), T0).state;
    const id = s.orders[0].id;
    s = modifyOrder(s, id, { limitPrice: 195, qty: 50 }, quotes(AAPL), T0).state;
    expect(s.orders[0]).toMatchObject({ limitPrice: 195, qty: 50, status: 'working' });
    s = modifyOrder(s, id, { limitPrice: 202 }, quotes(AAPL), T0).state;
    expect(s.positions.AAPL).toMatchObject({ qty: 50, avgPrice: 201.57 });
  });

  it('moving an entry price carries its SL / TP by the same distance', () => {
    let s = placeOrder(createEngineState(), draft({ type: 'limit', limitPrice: 200, takeProfit: 201, stopLoss: 199.5 }), quotes(AAPL), T0).state;
    s = modifyOrder(s, s.orders[0].id, { limitPrice: 199 }, quotes(AAPL), T0).state;
    expect(s.orders[0]).toMatchObject({ limitPrice: 199, takeProfit: 200, stopLoss: 198.5 });
  });

  it('modifying a bracket leg moves the exit', () => {
    let s = placeOrder(createEngineState(), draft({ stopLoss: 197.5 }), quotes(AAPL), T0).state;
    const sl = working(s)[0];
    s = modifyOrder(s, sl.id, { stopPrice: 200 }, quotes(AAPL), T0).state;
    s = onQuote(s, q(200, 200.01), T0).state;
    expect(s.positions.AAPL).toBeUndefined();
  });
});
