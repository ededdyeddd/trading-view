import { describe, expect, it } from 'vitest';
import type { OrderDraft } from '../engine/types';
import { checkDraft, getScenario } from './scenarios';

const market = { bid: 201.56, ask: 201.57 };
const d = (p: Partial<OrderDraft>): OrderDraft => ({ symbol: 'AAPL', side: 'buy', type: 'market', qty: 100, tif: 'week', ...p });

describe('scenario auto-check', () => {
  it('1: market buy 100 with SL 197.50 / TP 211.00', () => {
    const s = getScenario(1)!;
    expect(checkDraft(d({ stopLoss: 197.5, takeProfit: 211 }), s, market)).toEqual({ pass: true, mismatches: [] });
    expect(checkDraft(d({ qty: 101, stopLoss: 197.5, takeProfit: 211 }), s, market).pass).toBe(true); // ±1 share
    expect(checkDraft(d({ qty: 98, stopLoss: 197.5, takeProfit: 211 }), s, market).mismatches).toEqual(['qty: 98 ≠ 100']);
    expect(checkDraft(d({ stopLoss: 197.5 }), s, market).mismatches).toEqual(['TP: — ≠ 211']);
  });
  it('2: buy limit 199.00, 100 shares, SL 195 / TP 207', () => {
    const s = getScenario(2)!;
    expect(checkDraft(d({ type: 'limit', limitPrice: 199, stopLoss: 195, takeProfit: 207 }), s, market).pass).toBe(true);
    expect(checkDraft(d({ type: 'limit', limitPrice: 199.01, stopLoss: 195, takeProfit: 207 }), s, market).mismatches).toEqual(['price: 199.01 ≠ 199.00']);
  });
  it('3: sell limit 1 USD above the market, week', () => {
    const s = getScenario(3)!;
    expect(checkDraft(d({ side: 'sell', type: 'limit', qty: 10, limitPrice: 202.56 }), s, market).pass).toBe(true);
    expect(checkDraft(d({ side: 'sell', type: 'limit', qty: 10, limitPrice: 202.56, tif: 'day' }), s, market).mismatches).toEqual(['TIF: day ≠ week']);
    expect(checkDraft(null, s, market)).toEqual({ pass: false, mismatches: ['no order submitted'] });
  });
});
