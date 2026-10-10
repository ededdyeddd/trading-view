import { describe, expect, it } from 'vitest';
import { getSpec } from '../config/symbols';
import { ceilToStep, defaultOrderPrice, niceStep, roundToTick } from '../lib/orderMath';
import type { Quote } from '../market/types';
import { evaluatePriceStatus, statusPatch, submitCheck } from './priceField';
import type { TicketState } from './types';

const AAPL = getSpec('AAPL');
const q = (bid: number, ask = roundToTick(bid + 0.01, 0.01)): Quote => ({ symbol: 'AAPL', bid, ask, last: ask, ts: 0 });
const QUOTE = q(201.56, 201.57);

function st(p: Partial<TicketState> = {}): TicketState {
  return {
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    priceInput: '',
    priceUnit: 'price',
    priceStatus: 'ok',
    qtyUnit: 'units',
    qtyInput: '',
    sl: { enabled: false, unit: 'price', input: '', touched: true },
    tp: { enabled: false, unit: 'price', input: '', touched: true },
    tif: 'week',
    gtdDate: '',
    gtdTime: '',
    levels: [],
    fillOutsideRth: false,
    ...p,
  };
}

/** Applies a patch like the store does. */
const apply = (s: TicketState, patch: Partial<TicketState> | null): TicketState => (patch ? { ...s, ...patch } : s);
const BID = { bid: 201.56, ask: 201.57 };

describe('default price: the grey placeholder (Limit 1%, Stop 1.5% from Ask / Bid, on a round step)', () => {
  it.each([
    [201.57, 1],
    [42.38, 0.1],
    [1.0852, 0.01],
  ])('nice step of %d is %d', (ref, step) => expect(niceStep(ref, 0.01)).toBe(step));
  it('never finer than the tick', () => expect(niceStep(1.0852, 0.1)).toBe(0.1));
  it('AAPL Bid 201.56 / Ask 201.57: Buy Limit 199, Sell Limit 204, Buy Stop 205, Sell Stop 198', () => {
    expect(defaultOrderPrice('limit', 'buy', BID.bid, BID.ask, 0.01)).toBe(199);
    expect(defaultOrderPrice('limit', 'sell', BID.bid, BID.ask, 0.01)).toBe(204);
    expect(defaultOrderPrice('stop', 'buy', BID.bid, BID.ask, 0.01)).toBe(205);
    expect(defaultOrderPrice('stop', 'sell', BID.bid, BID.ask, 0.01)).toBe(198);
  });
  it('AA Ask 42.38 → Buy Limit 41.90, Buy Stop 43.10', () => {
    expect(defaultOrderPrice('limit', 'buy', 42.37, 42.38, 0.01)).toBe(41.9);
    expect(defaultOrderPrice('stop', 'buy', 42.37, 42.38, 0.01)).toBe(43.1);
  });
  it('the placeholder is on the resting side, so it never warns', () => {
    for (const type of ['limit', 'stop'] as const)
      for (const side of ['buy', 'sell'] as const) {
        const price = defaultOrderPrice(type, side, BID.bid, BID.ask, 0.01);
        const s = st({ type, side, priceInput: price.toFixed(2) });
        expect(evaluatePriceStatus(s, QUOTE, AAPL)).toBe('ok');
      }
  });
  it('ceilToStep ignores float noise', () => expect(ceilToStep(42.9, 0.1)).toBe(42.9));
});

describe('price status (committed, never on ticks)', () => {
  it('user types 201.60 for a Buy Limit at Ask 201.57 → fillsNow after commit', () => {
    expect(evaluatePriceStatus(st({ priceInput: '201.60' }), QUOTE, AAPL)).toBe('fillsNow');
  });
  it('an empty price has no status', () => {
    expect(evaluatePriceStatus(st(), QUOTE, AAPL)).toBe('ok');
  });
  it('an offset is evaluated like the price it stands for: +0.03 from Ask is 201.60', () => {
    expect(evaluatePriceStatus(st({ priceUnit: 'offset', priceInput: '0.03' }), QUOTE, AAPL)).toBe('fillsNow');
    expect(evaluatePriceStatus(st({ priceUnit: 'offset', priceInput: '−2.57' }), QUOTE, AAPL)).toBe('ok');
  });
  it('the market moving afterwards changes nothing until the next commit / submit', () => {
    const s = st({ priceInput: '201.60', priceStatus: 'fillsNow' });
    const higher = q(202.0);
    expect(evaluatePriceStatus(s, higher, AAPL)).toBe('ok');
    expect(submitCheck(s, higher, AAPL)).toEqual({ send: true, priceStatus: 'ok' });
  });
  it('Buy → Sell keeps the typed price and re-evaluates its status', () => {
    const buy = st({ priceInput: '199.00' });
    const sell = apply({ ...buy, side: 'sell' }, statusPatch({ ...buy, side: 'sell' }, QUOTE, AAPL));
    expect([sell.priceInput, sell.priceStatus]).toEqual(['199.00', 'fillsNow']);
  });
});

describe('submit', () => {
  it('a price that just turned bad is not sent; the warning shows and the next click sends', () => {
    const s = st({ priceInput: '201.00', priceStatus: 'ok' });
    const first = submitCheck(s, q(200.9), AAPL);
    expect(first).toEqual({ send: false, priceStatus: 'fillsNow' });
    expect(submitCheck({ ...s, priceStatus: first.priceStatus }, q(200.9), AAPL).send).toBe(true);
  });
  it('a warning already shown does not block', () => {
    expect(submitCheck(st({ priceInput: '201.60', priceStatus: 'fillsNow' }), QUOTE, AAPL).send).toBe(true);
  });
  it('an ok price is sent', () => {
    expect(submitCheck(st({ priceInput: '199.00' }), QUOTE, AAPL)).toEqual({ send: true, priceStatus: 'ok' });
  });
});
