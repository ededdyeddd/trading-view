import { describe, expect, it } from 'vitest';
import { getSpec } from '../config/symbols';
import {
  checkPrice,
  exitsSummary,
  nextLevel,
  scaleLevels,
  sortLevelIndices,
  convertRisk,
  defaultRiskInput,
  describeExit,
  maxQtyForMargin,
  priceFromOffset,
  riskPerUnit,
  floorToStep,
  marginFor,
  offsetTicks,
  pnl,
  qtyEquivalents,
  resolveExit,
  resolveQty,
  riskReward,
  roundToTick,
  tickValue,
  tradeValue,
} from './orderMath';

const AAPL = getSpec('AAPL');
const BTC = getSpec('BTCUSDT');
const USDJPY = getSpec('USDJPY');

// Reference numbers come from the Figma annotations (file e0zJvrcoBdJiypZDxVhY4O):
// Market buy, entry = Ask 201.57, balance 99,953.90 USD, SL 197.50 (−4.07 per share).
const ENTRY = 201.57;
const BALANCE = 99_953.9;
const SL_DIST = 4.07;

describe('rounding', () => {
  it('rounds prices to tick without float noise', () => {
    expect(roundToTick(201.565, 0.01)).toBe(201.57);
    expect(roundToTick(197.4979, 0.01)).toBe(197.5);
    expect(roundToTick(1.124815, 0.00001)).toBe(1.12482);
  });
  it('floors quantity to step', () => {
    expect(floorToStep(99.22, 1)).toBe(99);
    expect(floorToStep(0.123456, 0.00001)).toBe(0.12345);
    expect(floorToStep(3, 1)).toBe(3);
  });
});

describe('value, margin, tick', () => {
  it('stocks use 2% margin', () => {
    expect(tradeValue(100, ENTRY, AAPL)).toBeCloseTo(20_157, 6);
    expect(marginFor(100, ENTRY, AAPL)).toBeCloseTo(403.14, 2);
    expect(tickValue(100, AAPL, ENTRY)).toBeCloseTo(1, 6);
    expect(tickValue(99, AAPL, ENTRY)).toBeCloseTo(0.99, 6);
  });
  it('crypto uses symbol leverage', () => {
    expect(marginFor(1, 80_000, BTC)).toBeCloseTo(80_000 / (BTC.leverage ?? 1), 6);
  });
  it('converts JPY-quoted P&L to USD', () => {
    // 10,000 USDJPY from 150.000 to 151.000 = +10,000 JPY ≈ +66.23 USD at 151
    expect(pnl('buy', 10_000, 150, 151, USDJPY)).toBeCloseTo(10_000 / 151, 6);
    expect(tradeValue(10_000, 150, USDJPY)).toBeCloseTo(10_000, 6);
  });
  it('pnl is signed by side', () => {
    expect(pnl('buy', 10, 100, 101, AAPL)).toBeCloseTo(10);
    expect(pnl('sell', 10, 100, 101, AAPL)).toBeCloseTo(-10);
  });
});

describe('quantity units (Figma "Quantity" table)', () => {
  const base = { price: ENTRY, balance: BALANCE, slDistance: SL_DIST, spec: AAPL };

  it('Shares 100 → 20,157.00 USD, margin 403.14, tick 1.00', () => {
    const { qty } = resolveQty({ ...base, unit: 'units', value: 100 });
    expect(qty).toBe(100);
    const eq = qtyEquivalents(qty, ENTRY, BALANCE, SL_DIST, AAPL);
    expect(eq.value).toBe(20_157);
  });
  it('USD 20,000 → 99 shares, margin 399.11, tick 0.99', () => {
    const { qty } = resolveQty({ ...base, unit: 'value', value: 20_000 });
    expect(qty).toBe(99);
    expect(marginFor(qty, ENTRY, AAPL)).toBeCloseTo(399.11, 2);
    expect(tickValue(qty, AAPL, ENTRY)).toBeCloseTo(0.99, 6);
  });
  it('% balance 20 → 99 shares', () => {
    expect(resolveQty({ ...base, unit: 'balancePercent', value: 20 }).qty).toBe(99);
  });
  it('Risk USD 400 → 98 shares, real risk 398.86, margin 395.08', () => {
    const { qty } = resolveQty({ ...base, unit: 'riskMoney', value: 400 });
    expect(qty).toBe(98);
    expect(qtyEquivalents(qty, ENTRY, BALANCE, SL_DIST, AAPL).riskMoney).toBe(398.86);
    expect(marginFor(qty, ENTRY, AAPL)).toBeCloseTo(395.08, 2);
  });
  it('Risk % balance 0.5 → 122 shares, real risk 496.54, margin 491.83', () => {
    const { qty } = resolveQty({ ...base, unit: 'riskBalancePercent', value: 0.5 });
    expect(qty).toBe(122);
    expect(qtyEquivalents(qty, ENTRY, BALANCE, SL_DIST, AAPL).riskMoney).toBe(496.54);
    expect(marginFor(qty, ENTRY, AAPL)).toBeCloseTo(491.83, 2);
  });
  it('risk units without stop loss cannot be resolved', () => {
    const r = resolveQty({ ...base, slDistance: null, unit: 'riskMoney', value: 400 });
    expect(r).toEqual({ qty: 0, needsStopLoss: true });
  });
  it('zero or empty input gives zero quantity', () => {
    expect(resolveQty({ ...base, unit: 'units', value: 0 }).qty).toBe(0);
    expect(resolveQty({ ...base, unit: 'units', value: Number.NaN }).qty).toBe(0);
  });
});

describe('stop loss units (Figma "Stop loss" table, entry 201.57, 100 shares)', () => {
  const base = { kind: 'sl' as const, side: 'buy' as const, entry: ENTRY, qty: 100, balance: BALANCE, spec: AAPL };
  const expectLevel = (unit: Parameters<typeof resolveExit>[0]['unit'], value: number) => {
    const lvl = resolveExit({ ...base, unit, value });
    expect(lvl).not.toBeNull();
    expect(lvl!.price).toBe(197.5);
    expect(lvl!.money).toBe(-407);
    expect(lvl!.ticks).toBe(407);
    expect(lvl!.percent).toBeCloseTo(2.02, 2);
    expect(lvl!.invalid).toBe(false);
    return lvl!;
  };
  it('price 197.50', () => expectLevel('price', 197.5));
  it('407 ticks', () => expectLevel('ticks', 407));
  it('2.02 % price', () => expectLevel('percent', 2.02));
  it('407.00 USD risk', () => expectLevel('money', 407));
  it('0.41 % balance (rounds to the nearest tick)', () => {
    const lvl = resolveExit({ ...base, unit: 'balancePercent', value: 0.41 });
    // 0.41% of 99,953.90 = 409.81 → 4.0981/share → 197.47
    expect(lvl!.price).toBe(197.47);
    expect(describeExit('sl', 'buy', ENTRY, 100, 197.5, BALANCE, AAPL).balancePercent).toBeCloseTo(0.41, 2);
  });
  it('a sell stop loss sits above entry', () => {
    const lvl = resolveExit({ ...base, side: 'sell', unit: 'ticks', value: 25 });
    expect(lvl!.price).toBe(201.82);
    expect(lvl!.money).toBe(-25);
  });
  it('a stop loss on the wrong side is invalid', () => {
    expect(resolveExit({ ...base, unit: 'price', value: 205 })!.invalid).toBe(true);
  });
});

describe('take profit units (Figma "Take profit" table)', () => {
  const base = { kind: 'tp' as const, side: 'buy' as const, entry: ENTRY, qty: 100, balance: BALANCE, spec: AAPL };
  it.each([
    ['price', 211],
    ['ticks', 943],
    ['percent', 4.68],
    ['money', 943],
  ] as const)('%s %d → 211.00, +943.00 USD', (unit, value) => {
    const lvl = resolveExit({ ...base, unit, value })!;
    expect(lvl.price).toBe(211);
    expect(lvl.money).toBe(943);
    expect(lvl.percent).toBeCloseTo(4.68, 2);
  });
  it('reward % balance 0.94 of balance', () => {
    expect(describeExit('tp', 'buy', ENTRY, 100, 211, BALANCE, AAPL).balancePercent).toBeCloseTo(0.94, 2);
  });
  it('risk/reward 943 / 407 ≈ 2.32', () => {
    expect(riskReward(4.07, 9.43)).toBeCloseTo(2.32, 2);
    expect(riskReward(0, 9.43)).toBeNull();
  });
});

describe('price checks (Figma "Limit Price")', () => {
  const bid = 201.56;
  const ask = 201.57;
  it('offset from Ask in ticks', () => {
    expect(offsetTicks(199, 'buy', bid, ask, 0.01)).toBe(-257);
    expect(offsetTicks(201.64, 'buy', bid, ask, 0.01)).toBe(7);
    expect(offsetTicks(205, 'sell', bid, ask, 0.01)).toBe(344);
  });
  it('buy limit above Ask fills now; sell limit below Bid fills now', () => {
    expect(checkPrice('limit', 'buy', 201.64, bid, ask)).toEqual({ fillsNow: true, invalid: false });
    expect(checkPrice('limit', 'buy', 199, bid, ask).fillsNow).toBe(false);
    expect(checkPrice('limit', 'sell', 201.5, bid, ask).fillsNow).toBe(true);
  });
  it('buy stop must be above Ask, sell stop below Bid', () => {
    expect(checkPrice('stop', 'buy', 201.57, bid, ask).invalid).toBe(true);
    expect(checkPrice('stop', 'buy', 202, bid, ask).invalid).toBe(false);
    expect(checkPrice('stop', 'sell', 202, bid, ask).invalid).toBe(true);
    expect(checkPrice('stop', 'sell', 200, bid, ask).invalid).toBe(false);
  });
});

describe('step 2b formulas', () => {
  it('signed offset: Ask − 2.57 → 199.00; Ask + 3.43 → 205.00; Bid + 1.00 → 202.56', () => {
    expect(priceFromOffset('buy', 201.56, 201.57, -2.57, 0.01)).toBe(199);
    expect(priceFromOffset('buy', 201.56, 201.57, 3.43, 0.01)).toBe(205);
    expect(priceFromOffset('sell', 201.56, 201.57, 1, 0.01)).toBe(202.56);
  });
  it('Risk USD 400, SL 197.50 at Market → 98 shares, real risk 398.86, margin 395.08', () => {
    const { qty } = resolveQty({ unit: 'riskMoney', value: 400, price: ENTRY, balance: BALANCE, slDistance: SL_DIST, spec: AAPL });
    expect(qty).toBe(98);
    expect(qtyEquivalents(qty, ENTRY, BALANCE, SL_DIST, AAPL).riskMoney).toBe(398.86);
    expect(marginFor(qty, ENTRY, AAPL)).toBeCloseTo(395.08, 2);
  });
  it('Limit example: entry 199.00, Risk USD 400, SL 195.00 → 100 shares, real risk 400.00, margin 398.00', () => {
    const { qty } = resolveQty({ unit: 'riskMoney', value: 400, price: 199, balance: BALANCE, slDistance: 4, spec: AAPL });
    expect(qty).toBe(100);
    expect(qtyEquivalents(qty, 199, BALANCE, 4, AAPL).riskMoney).toBe(400);
    expect(marginFor(qty, 199, AAPL)).toBeCloseTo(398, 6);
  });
  it('risk below 1 share: 4.07 USD per share', () => {
    expect(riskPerUnit(201.57, 197.5, AAPL)).toBeCloseTo(4.07, 6);
    expect(resolveQty({ unit: 'riskMoney', value: 3, price: ENTRY, balance: BALANCE, slDistance: SL_DIST, spec: AAPL }).qty).toBe(0);
  });
  it('max shares by margin: floor(99,953.90 / (201.57 × 2%)) = floor(24,793.84) = 24,793 (prompt rounds to 24,794)', () => {
    expect(maxQtyForMargin(BALANCE, ENTRY, AAPL)).toBe(24_793);
  });
});

describe('risk input default (1% of balance)', () => {
  it('Risk USD rounds to whole USD, Risk % balance is 1.00', () => {
    expect(defaultRiskInput('riskMoney', 99_953.9)).toBe('1000');
    expect(defaultRiskInput('riskBalancePercent', 99_953.9)).toBe('1.00');
  });
  it('converts a typed risk between the two units', () => {
    expect(convertRisk(1, 'riskMoney', 100_000)).toBe(1000);
    expect(convertRisk(500, 'riskBalancePercent', 100_000)).toBe(0.5);
  });
});

describe('partial exits: summary, scaling, adding a level (spec examples, Buy 100 AAPL @ 201.57)', () => {
  const E = 201.57;
  it('one level 100 · SL 197.50 · TP 211.00 → SL −407.00 · TP +943.00', () => {
    const s = exitsSummary('buy', E, 100, [{ qty: 100, sl: 197.5, tp: 211 }], AAPL);
    expect([s.sl, s.tp, s.levels, s.unprotectedQty, s.noStop]).toEqual([-407, 943, 1, 0, false]);
  });
  it('50 / 25 / 25 with TP 206 / 211 / 216, all SL 197.50 → SL −407.00 · TP up to +818.00 · 3 levels', () => {
    const s = exitsSummary(
      'buy',
      E,
      100,
      [
        { qty: 50, sl: 197.5, tp: 206 },
        { qty: 25, sl: 197.5, tp: 211 },
        { qty: 25, sl: 197.5, tp: 216 },
      ],
      AAPL,
    );
    expect([s.sl, s.tp, s.levels, s.protectedQty, s.unprotectedQty]).toEqual([-407, 818, 3, 100, 0]);
  });
  it('80 of 100 → SL −325.60 · TP +754.40 · 20 shares without SL/TP', () => {
    const s = exitsSummary('buy', E, 100, [{ qty: 80, sl: 197.5, tp: 211 }], AAPL);
    expect([s.sl, s.tp, s.unprotectedQty]).toEqual([-325.6, 754.4, 20]);
  });
  it('TP without any SL → "No stop loss", no SL total', () => {
    const s = exitsSummary('buy', E, 100, [{ qty: 100, sl: null, tp: 211 }], AAPL);
    expect([s.sl, s.tp, s.noStop]).toEqual([null, 943, true]);
  });
  it('Sell 100 @ 201.56 (Bid), SL 205.00, TP 195.00 → SL −344.00 · TP +656.00', () => {
    const s = exitsSummary('sell', 201.56, 100, [{ qty: 100, sl: 205, tp: 195 }], AAPL);
    expect([s.sl, s.tp]).toEqual([-344, 656]);
  });
  it('levels keep their shares when the order quantity changes; the leftover goes to Exit 1', () => {
    expect(scaleLevels([0.5, 0.25, 0.25], 100, 1)).toEqual([50, 25, 25]);
    expect(scaleLevels([0.5, 0.25, 0.25], 99, 1)).toEqual([51, 24, 24]); // floors 49 / 24 / 24 = 97, the total is 99 → +2 to Exit 1
    expect(scaleLevels([0.5, 0.25, 0.25], 10, 1)).toEqual([6, 2, 2]); // 5 / 2 / 2 = 9, the total is 10 → Exit 1 gets 6
    expect(scaleLevels([0.6, 0.2], 100, 1)).toEqual([60, 20]); // an unprotected 20% stays unprotected
    expect(scaleLevels([0.5, 0.5], 99, 1)).toEqual([50, 49]);
    // idempotent: the same total always gives the same levels
    expect(scaleLevels([0.5, 0.25, 0.25], 99, 1)).toEqual(scaleLevels([0.5, 0.25, 0.25], 99, 1));
  });
  it('rows are sorted by take profit, nearest first (Buy ascending, Sell descending), no TP last', () => {
    expect(sortLevelIndices('buy', [216, null, 206, 211])).toEqual([2, 3, 0, 1]);
    expect(sortLevelIndices('sell', [190, 195, null, 185])).toEqual([1, 0, 3, 2]);
  });
  it('adding a level: 100 shares, TP 211.00 → Exit 1: 50 @ 211.00, Exit 2: 50 @ 220.43; SL copied', () => {
    expect(nextLevel({ qty: 100, tp: 211, sl: 197.5 }, null, E, 1, 0.01)).toEqual({ newQty: 50, lastQty: 50, tp: 220.43, sl: 197.5 });
    // a second step continues the series from the previous TP
    expect(nextLevel({ qty: 50, tp: 220.43, sl: 197.5 }, 211, E, 1, 0.01)).toMatchObject({ newQty: 25, lastQty: 25, tp: 229.86 });
    // odd quantity: the remainder stays with the last level
    expect(nextLevel({ qty: 5, tp: 211, sl: null }, null, E, 1, 0.01)).toMatchObject({ newQty: 2, lastQty: 3, sl: null });
    // no TP on the last level → none on the new one
    expect(nextLevel({ qty: 10, tp: null, sl: 197.5 }, null, E, 1, 0.01)?.tp).toBeNull();
    // fewer than 2 steps cannot be split
    expect(nextLevel({ qty: 1, tp: 211, sl: null }, null, E, 1, 0.01)).toEqual({ newQty: 0, lastQty: 1, tp: 220.43, sl: null });
  });
});
