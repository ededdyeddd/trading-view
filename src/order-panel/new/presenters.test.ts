import { describe, expect, it } from 'vitest';
import { getSpec } from '../../config/symbols';
import type { Quote } from '../../market/types';
import { NEW_RULES, deriveTicket, type TicketContext } from '../../order-ticket/deriveTicket';
import { evaluatePriceStatus } from '../../order-ticket/priceField';
import type { ExitUnit, QtyUnit } from '../../lib/orderMath';
import type { ExitState, LevelState, TicketState } from '../../order-ticket/types';
import {
  DASH,
  exitMenuValue,
  exitText,
  exitUnitBlocked,
  exitUnitsFor,
  exitUnitInfo,
  formatExitInput,
  formatQtyInput,
  marketClosedText,
  exitHeadingText,
  levelPercentText,
  levelRowParts,
  levelMenuValue,
  orderTitleText,
  placedToastText,
  priceLabel,
  priceSwapLabel,
  priceText,
  priceWarning,
  qtyMenuValue,
  qtyPlaceholder,
  qtyText,
  qtyUnitInfo,
  riskRewardText,
  submitText,
  summaryParts,
  summaryText,
  tifMenuText,
  tifRowText,
  tifText,
} from './presenters';

// Figma / prompt reference: Market Buy, entry = Ask 201.57, balance 99,953.90 USD.
const AAPL = getSpec('AAPL');
const NOW = new Date(2026, 9, 8, 12, 0, 0).getTime();
const quote: Quote = { symbol: 'AAPL', bid: 201.56, ask: 201.57, last: 201.57, ts: NOW };
const ctx: TicketContext = { quote, spec: AAPL, balance: 99_953.9, availableFunds: 99_953.9, now: NOW };

const off: ExitState = { enabled: false, unit: 'price', input: '', touched: true };
function st(p: Partial<TicketState> = {}): TicketState {
  return {
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    priceInput: '',
    priceUnit: 'price',
    priceStatus: 'ok',
    qtyUnit: 'units',
    qtyInput: '',
    sl: off,
    tp: off,
    tif: 'week',
    gtdDate: '',
    gtdTime: '',
    levels: [],
    fillOutsideRth: false,
    ...p,
  };
}
const on = (unit: ExitState['unit'], input: string): ExitState => ({ enabled: true, unit, input, touched: true });

describe('Quantity table', () => {
  it('empty → grey 1 · 201.57 USD · Available margin', () => {
    const s = st();
    const t = qtyText(s, deriveTicket(s, ctx), AAPL);
    expect([t.right, t.rightTone, t.caption]).toEqual(['201.57 USD', 'muted', 'Available margin 99,953.90 USD']);
  });
  it('Shares 100 → 20,157.00 USD · Margin 403.14 USD · Tick 1.00 USD', () => {
    const s = st({ qtyInput: '100' });
    const t = qtyText(s, deriveTicket(s, ctx), AAPL);
    expect([formatQtyInput('100', 'units', AAPL), t.suffix, t.right, t.caption]).toEqual(['100', '', '20,157.00 USD', 'Margin 403.14 USD · Tick 1.00 USD']);
  });
  it('USD 20,000.00 → 99 shares · Margin 399.11 USD · Tick 0.99 USD', () => {
    const s = st({ qtyUnit: 'value', qtyInput: '20000' });
    const t = qtyText(s, deriveTicket(s, ctx), AAPL);
    expect([formatQtyInput('20000', 'value', AAPL), t.suffix, t.right, t.caption]).toEqual([
      '20,000.00',
      '',
      '99 shares',
      'Margin 399.11 USD · Tick 0.99 USD',
    ]);
  });
  it('% balance 20 % → 99 shares · Margin 399.11 USD · Tick 0.99 USD', () => {
    const s = st({ qtyUnit: 'balancePercent', qtyInput: '20' });
    const t = qtyText(s, deriveTicket(s, ctx), AAPL);
    expect([formatQtyInput('20', 'balancePercent', AAPL), t.suffix, t.right, t.caption]).toEqual(['20', '', '99 shares', 'Margin 399.11 USD · Tick 0.99 USD']);
  });
});

describe('Stop loss table (entry 201.57, 100 shares)', () => {
  const rows: [ExitState['unit'], string, string, string, string][] = [
    ['price', '197.50', '197.50', '−407.00 USD', '−4.07 (−2.02%) from entry'],
    ['ticks', '407', '407', '−407.00 USD', 'At 197.50 · −2.02% from entry'],
    ['percent', '2.02', '2.02', '−407.00 USD', 'At 197.50 · −4.07 from entry'],
    ['money', '407', '407.00', '197.50', '−4.07 (−2.02%) from entry'],
    ['balancePercent', '0.4072', '0.41', '−407.00 USD', 'At 197.50 · −4.07 (−2.02%) from entry'],
  ];
  it.each(rows)('%s', (unit, input, left, right, caption) => {
    const s = st({ qtyInput: '100', sl: on(unit, input) });
    const t = exitText('sl', s, deriveTicket(s, ctx), AAPL);
    const shownLeft =
      unit === 'balancePercent' ? Number(input).toFixed(2) : formatExitInput(input, unit, AAPL);
    expect(t.suffix).toBe('');
    expect([shownLeft, t.right, t.caption]).toEqual([left, right, caption]);
  });
});

describe('Take profit table (mirror)', () => {
  const rows: [ExitState['unit'], string, string, string, string][] = [
    ['price', '211.00', '211.00', '+943.00 USD', '+9.43 (+4.68%) from entry'],
    ['ticks', '943', '943', '+943.00 USD', 'At 211.00 · +4.68% from entry'],
    ['percent', '4.68', '4.68', '+943.00 USD', 'At 211.00 · +9.43 from entry'],
    ['money', '943', '943.00', '211.00', '+9.43 (+4.68%) from entry'],
    ['balancePercent', '0.9434', '0.94', '+943.00 USD', 'At 211.00 · +9.43 (+4.68%) from entry'],
  ];
  it.each(rows)('%s', (unit, input, left, right, caption) => {
    const s = st({ qtyInput: '100', tp: on(unit, input) });
    const t = exitText('tp', s, deriveTicket(s, ctx), AAPL);
    const shownLeft =
      unit === 'balancePercent' ? Number(input).toFixed(2) : formatExitInput(input, unit, AAPL);
    expect(t.suffix).toBe('');
    expect([shownLeft, t.right, t.caption]).toEqual([left, right, caption]);
  });
});

describe('Sell mirrors sides', () => {
  it('sell SL sits above entry (Bid 201.56) and still costs money', () => {
    const s = st({ side: 'sell', qtyInput: '100', sl: on('price', '205.63') });
    const t = exitText('sl', s, deriveTicket(s, ctx), AAPL);
    expect([t.right, t.caption]).toEqual(['−407.00 USD', '+4.07 (+2.02%) from entry']);
  });
  it('sell SL below entry is an error', () => {
    const s = st({ side: 'sell', qtyInput: '100', sl: on('price', '200') });
    const v = deriveTicket(s, ctx);
    expect(exitText('sl', s, v, AAPL)).toMatchObject({ caption: 'Stop loss must be above entry', captionTone: 'error' });
    expect(submitText(s, v, AAPL).secondary).toBe('Stop loss must be above entry');
  });
});

describe('Summary and submit button (step 3 table)', () => {
  const view = (s: TicketState, c = ctx) => deriveTicket(s, c);
  it('no quantity', () => {
    const s = st();
    expect(summaryText(view(s), AAPL)).toBeNull();
    expect(submitText(s, view(s), AAPL)).toEqual({
      primary: 'Buy',
      secondary: 'Enter quantity to buy AAPL',
      disabled: true,
      reason: 'Enter quantity to buy AAPL',
    });
  });
  it('quantity, no exits', () => {
    const s = st({ qtyInput: '100' });
    expect(summaryText(view(s), AAPL)).toBeNull();
    expect(submitText(s, view(s), AAPL)).toMatchObject({ primary: 'Buy', secondary: '100 AAPL · MKT', disabled: false });
  });
  it('SL and TP', () => {
    const s = st({ qtyInput: '100', sl: on('price', '197.50'), tp: on('price', '211.00') });
    expect(summaryText(view(s), AAPL)).toBe('SL −407.00 USD · TP +943.00 USD');
    expect(submitText(s, view(s), AAPL).secondary).toBe('100 AAPL · MKT');
    expect(riskRewardText(view(s).riskReward!)).toBe('1 : 2.32');
  });
  it('one exit', () => {
    const s = st({ qtyInput: '100', sl: on('price', '197.50') });
    expect(summaryText(view(s), AAPL)).toBe('SL −407.00 USD');
  });
  it('SL on the wrong side', () => {
    const s = st({ qtyInput: '100', sl: on('price', '205') });
    expect(summaryText(view(s), AAPL)).toBeNull();
    expect(submitText(s, view(s), AAPL)).toMatchObject({ secondary: 'Stop loss must be below entry', disabled: true });
  });
  it('TP on the wrong side', () => {
    const s = st({ qtyInput: '100', tp: on('price', '199') });
    expect(submitText(s, view(s), AAPL)).toMatchObject({ secondary: 'Take profit must be above entry', disabled: true });
  });
  it('not enough margin', () => {
    const s = st({ qtyInput: '100' });
    const v = view(s, { ...ctx, availableFunds: 100 });
    expect(submitText(s, v, AAPL)).toMatchObject({ secondary: 'Not enough margin', disabled: true });
    expect(qtyText(s, v, AAPL)).toMatchObject({ caption: 'Not enough margin for 100 shares · max 24', captionTone: 'error' });
  });
  it('sell button', () => {
    const s = st({ side: 'sell' });
    expect(submitText(s, view(s), AAPL)).toMatchObject({ primary: 'Sell', secondary: 'Enter quantity to sell AAPL' });
  });
});

describe('Time in force', () => {
  it('Week = today + 7 days', () => {
    expect(tifText('week', NOW)).toBe('Week · Oct 15');
    expect(tifText('day', NOW)).toBe('Day · Oct 8');
  });
});

// ---------------------------------------------------------------------------
// Step 2b
// ---------------------------------------------------------------------------

const nctx: TicketContext = { ...ctx, rules: NEW_RULES };
const nv = (s: TicketState, c: Partial<TicketContext> = {}) => deriveTicket(s, { ...nctx, ...c });
/** The price as validated on commit (warnings follow the committed status, not the live market). */
const committed = (s: TicketState): TicketState => ({ ...s, priceStatus: evaluatePriceStatus(s, quote, AAPL) });

describe('Block 1. Limit Price', () => {
  it('emptied: placeholder = the default 199.00, grey "Ask − 2.57" on the right; button "Enter price and quantity"', () => {
    const s = st({ type: 'limit' });
    const p = priceText(s, nv(s), AAPL);
    expect([p.placeholder, p.right, p.caption]).toEqual(['199.00', 'Ask − 2.57', null]);
    expect(submitText(s, nv(s), AAPL).secondary).toBe('Enter price and quantity');
  });
  it('Price 199.00 → Ask − 2.57', () => {
    const s = st({ type: 'limit', priceInput: '199.00' });
    expect(priceText(s, nv(s), AAPL)).toMatchObject({ right: 'Ask − 2.57', rightTone: 'neutral', caption: null });
  });
  it('⇆ Offset from Ask: −2.57 → 199.00 on the right; the label and tooltip follow the mode', () => {
    const s = st({ type: 'limit', priceUnit: 'offset', priceInput: '−2.57' });
    const v = nv(s);
    expect(priceText(s, v, AAPL)).toMatchObject({ suffix: '', right: '199.00' });
    expect(v.entry).toBe(199);
    expect([priceLabel('limit', 'price', 'buy'), priceLabel('stop', 'price', 'buy'), priceLabel('limit', 'offset', 'buy'), priceLabel('limit', 'offset', 'sell')]).toEqual([
      'Limit price',
      'Stop price',
      'Offset from Ask',
      'Offset from Bid',
    ]);
    expect([priceSwapLabel('price', 'buy'), priceSwapLabel('price', 'sell'), priceSwapLabel('offset', 'buy')]).toEqual([
      'Enter as offset from Ask',
      'Enter as offset from Bid',
      'Enter as price',
    ]);
  });
  it('a positive offset is above the market; typed with a hyphen or U+2212', () => {
    expect(nv(st({ type: 'limit', priceUnit: 'offset', priceInput: '0.43' })).entry).toBe(202);
    expect(nv(st({ type: 'limit', priceUnit: 'offset', priceInput: '-2.57' })).entry).toBe(199);
    expect(nv(st({ type: 'limit', side: 'sell', priceUnit: 'offset', priceInput: '2.44' })).entry).toBe(204);
  });
  it('Buy Limit above Ask: orange "Ask + 0.07", "Fills now: price is above Ask", button stays active', () => {
    const s = committed(st({ type: 'limit', priceInput: '201.64', qtyInput: '100' }));
    const v = nv(s);
    expect(priceText(s, v, AAPL)).toMatchObject({
      right: 'Ask + 0.07',
      rightTone: 'danger',
      caption: 'Fills now: price is above Ask',
      captionTone: 'error',
    });
    expect(submitText(s, v, AAPL).disabled).toBe(false);
  });
  it('Sell Limit counts from Bid; warning below Bid', () => {
    const s = st({ type: 'limit', side: 'sell', priceInput: '205.00' });
    expect(priceText(s, nv(s), AAPL).right).toBe('Bid + 3.44');
    const s2 = committed(st({ type: 'limit', side: 'sell', priceInput: '201.00' }));
    expect(priceText(s2, nv(s2), AAPL)).toMatchObject({ caption: 'Fills now: price is below Bid', captionTone: 'error' });
  });
  it('limit entry anchors exits: SL/TP from 199.00 (Figma Limit · Filled)', () => {
    const s = st({ type: 'limit', priceInput: '199.00', qtyInput: '100', sl: on('price', '195.00'), tp: on('price', '207.00') });
    const v = nv(s);
    expect(qtyText(s, v, AAPL)).toMatchObject({ right: '19,900.00 USD', caption: 'Margin 398.00 USD · Tick 1.00 USD' });
    expect(exitText('sl', s, v, AAPL)).toMatchObject({ right: '−400.00 USD', caption: '−4.00 (−2.01%) from entry' });
    expect(exitText('tp', s, v, AAPL)).toMatchObject({ right: '+800.00 USD', caption: '+8.00 (+4.02%) from entry' });
    expect(riskRewardText(v.riskReward!)).toBe('1 : 2.00');
    expect(summaryText(v, AAPL)).toBe('SL −400.00 USD · TP +800.00 USD');
    expect(submitText(s, v, AAPL).secondary).toBe('100 AAPL · LMT 199.00 · till Oct 15');
  });
});

describe('Block 2. Stop', () => {
  it('Buy Stop 205.00 → "100 AAPL · STP 205.00 · till Oct 15"', () => {
    const s = st({ type: 'stop', priceInput: '205.00', qtyInput: '100' });
    const v = nv(s);
    expect(priceText(s, v, AAPL)).toMatchObject({ right: 'Ask + 3.43', caption: null });
    expect(submitText(s, v, AAPL).secondary).toBe('100 AAPL · STP 205.00 · till Oct 15');
  });
  it('Buy Stop below Ask: "Triggers now: price is below Ask" (warning, submit allowed)', () => {
    const s = committed(st({ type: 'stop', priceInput: '201.00', qtyInput: '100' }));
    const v = nv(s);
    expect(priceText(s, v, AAPL)).toMatchObject({ caption: 'Triggers now: price is below Ask', captionTone: 'error' });
    expect(v.canSubmit).toBe(true);
  });
  it('Sell Stop above Bid: "Triggers now: price is above Bid"', () => {
    const s = committed(st({ type: 'stop', side: 'sell', priceInput: '202.00' }));
    expect(priceText(s, nv(s), AAPL).caption).toBe('Triggers now: price is above Bid');
  });
});

describe('Block 3. Risk modes', () => {
  it('Risk USD 400 at Market with SL 197.50 → 98 shares · "Margin 395.08 USD · Tick 0.98 USD"', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '400', sl: on('price', '197.50') });
    const t = qtyText(s, nv(s), AAPL);
    expect([formatQtyInput('400', 'riskMoney', AAPL), t.suffix, t.right, t.caption]).toEqual([
      '400.00',
      '',
      '98 shares',
      'Margin 395.08 USD · Tick 0.98 USD',
    ]);
  });
  it('Risk % balance 0.5 → 122 shares · "Margin 491.83 USD · Tick 1.22 USD"', () => {
    const s = st({ qtyUnit: 'riskBalancePercent', qtyInput: '0.5', sl: on('price', '197.50') });
    const t = qtyText(s, nv(s), AAPL);
    expect([formatQtyInput('0.5', 'riskBalancePercent', AAPL), t.suffix, t.right, t.caption]).toEqual([
      '0.5',
      '',
      '122 shares',
      'Margin 491.83 USD · Tick 1.22 USD',
    ]);
  });
  it('the actual risk shows only on the SL field (read-only) and in the summary', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '400', sl: on('price', '197.50') });
    const v = nv(s);
    expect(exitText('sl', s, v, AAPL)).toMatchObject({ right: '−398.86 USD', rightTone: 'neutral' });
    expect(summaryText(v, AAPL)).toBe('SL −398.86 USD');
    expect(qtyText(s, v, AAPL).caption).not.toMatch(/Real risk|398\.86/);
    expect(QTY.map((u) => qtyMenuValue(u, s, v, AAPL)).join(' ')).not.toMatch(/398\.86/);
  });
  it('shares follow SL, risk and entry; the other two inputs never change', () => {
    const base = st({ qtyUnit: 'riskMoney', qtyInput: '400', sl: on('price', '197.50') });
    expect(nv(base).qty.units).toBe(98);
    expect(nv({ ...base, sl: on('price', '195.57') }).qty.units).toBe(66); // SL moved: 400 / 6.00
    expect(nv({ ...base, qtyInput: '800' }).qty.units).toBe(196); // risk changed
    expect(nv(base, { quote: { ...quote, bid: 201.96, ask: 201.97 } }).qty.units).toBe(89); // Ask moved: 400 / 4.47
    const lim = st({ type: 'limit', priceInput: '199.00', qtyUnit: 'riskMoney', qtyInput: '400', sl: on('price', '195.00') });
    expect([nv(lim).qty.units, nv({ ...lim, priceInput: '197.00' }).qty.units]).toEqual([100, 200]); // limit price changed
  });
  it('pluralizes: 1 share, 2 shares', () => {
    const one = st({ qtyUnit: 'riskMoney', qtyInput: '5', sl: on('price', '197.50') });
    const two = st({ qtyUnit: 'riskMoney', qtyInput: '9', sl: on('price', '197.50') });
    expect([qtyText(one, nv(one), AAPL).right, qtyText(two, nv(two), AAPL).right]).toEqual(['1 share', '2 shares']);
  });
  it('main case: Buy Limit 199.00, Risk USD 400, SL 195.00, TP 207.00 → 100 shares, R:R 1 : 2.00', () => {
    const s = st({ type: 'limit', priceInput: '199.00', qtyUnit: 'riskMoney', qtyInput: '400', sl: on('price', '195.00'), tp: on('price', '207.00') });
    const v = nv(s);
    expect(v.qty.units).toBe(100);
    expect(qtyText(s, v, AAPL).caption).toBe('Margin 398.00 USD · Tick 1.00 USD');
    expect(riskRewardText(v.riskReward!)).toBe('1 : 2.00');
    expect(submitText(s, v, AAPL).secondary).toBe('100 AAPL · LMT 199.00 · till Oct 15');
    expect(v.draft).toMatchObject({ side: 'buy', type: 'limit', qty: 100, limitPrice: 199, stopLoss: 195, takeProfit: 207, tif: 'week' });
  });
  it('SL off: "—", no caption or link under the field, button "Set stop loss to calculate size"', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '400' });
    const v = nv(s);
    expect(qtyText(s, v, AAPL)).toMatchObject({ right: '—', caption: null });
    // SL on with a Limit price still empty: the stop distance counts from the price placeholder, so shares are computed
    const open = st({ type: 'limit', side: 'sell', qtyUnit: 'riskMoney', qtyInput: '1016', sl: on('price', '205.89') });
    expect(nv(open).qty.needsStopLoss).toBe(false);
    expect(qtyText(open, nv(open), AAPL).caption).not.toMatch(/stop loss/i);
    expect(submitText(s, v, AAPL)).toMatchObject({ secondary: 'Set stop loss to calculate size', disabled: true });
  });
  it('shares = 0: "0 shares", "Risk too small for 1 share (min 4.07 USD)", button disabled with this reason', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '3', sl: on('price', '197.50') });
    const v = nv(s);
    expect(qtyText(s, v, AAPL)).toMatchObject({ right: '0 shares', caption: 'Risk too small for 1 share (min 4.07 USD)', captionTone: 'error' });
    expect(submitText(s, v, AAPL)).toMatchObject({ secondary: 'Risk too small for 1 share (min 4.07 USD)', disabled: true });
  });
  it('not enough margin: "Not enough margin for {shares} shares · max {max}", button "Not enough margin"', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '400000', sl: on('price', '197.50') });
    const v = nv(s);
    expect(qtyText(s, v, AAPL)).toMatchObject({ caption: 'Not enough margin for 98,280 shares · max 24,793', captionTone: 'error' });
    expect(submitText(s, v, AAPL)).toMatchObject({ secondary: 'Not enough margin', disabled: true });
    expect(v.canSubmit).toBe(false);
  });
});

describe('Block 4. Time in force', () => {
  it('row and menu formats', () => {
    expect(tifRowText(st(), NOW)).toBe('Week · Oct 15');
    expect(tifMenuText('day', NOW, st())).toBe('Day · till Oct 8');
    expect(tifMenuText('week', NOW, st())).toBe('Week · till Oct 15');
    expect(tifMenuText('month', NOW, st())).toBe('Month · till Nov 8');
    expect(tifMenuText('gtd', NOW, st())).toBe('GTD · pick a date');
    const g = st({ tif: 'gtd', gtdDate: '2026-10-20', gtdTime: '14:30' });
    expect(tifRowText(g, NOW)).toBe('GTD · Oct 20 14:30');
    expect(tifText('week', NOW)).toBe('Week · Oct 15');
  });
  it('GTD on the button: "till Oct 20 14:30"; market has no date', () => {
    const g = st({ type: 'limit', priceInput: '199', qtyInput: '100', tif: 'gtd', gtdDate: '2026-10-20', gtdTime: '14:30' });
    expect(submitText(g, nv(g), AAPL).secondary).toBe('100 AAPL · LMT 199.00 · till Oct 20 14:30');
    const m = st({ qtyInput: '100' });
    expect(submitText(m, nv(m), AAPL).secondary).toBe('100 AAPL · MKT');
  });
});

describe('Block 5. Exits: levels, Protected size, summary (Buy 100 AAPL @ 201.57)', () => {
  const base = st({ qtyInput: '100', sl: on('price', '197.50'), tp: on('price', '211.00') });
  const lv = (frac: number, tp: string, sl: string): LevelState => ({ frac, tp: { unit: 'price', input: tp }, sl: { unit: 'price', input: sl } });
  const three = { ...base, levels: [lv(0.5, '206.00', '197.50'), lv(0.25, '211.00', '197.50'), lv(0.25, '216.00', '197.50')] };
  const text = (s: TicketState) => summaryText(nv(s), AAPL);

  it('one level: the plain SL / TP; summary "SL −407.00 USD · TP +943.00 USD", no "N exits", no levels in the view', () => {
    const v = nv(base);
    expect(text(base)).toBe('SL −407.00 USD · TP +943.00 USD');
    expect([v.levels.length, v.protectedQty, v.protectedPercent]).toEqual([0, 100, 100]);
    expect(v.draft).toMatchObject({ takeProfit: 211, stopLoss: 197.5 });
    expect(v.draft?.exitLevels).toBeUndefined();
  });
  it('3 levels 50 / 25 / 25: Protected size 100%, headings, rows, summary', () => {
    const v = nv(three);
    expect([v.protectedQty, levelPercentText(v.protectedPercent)]).toEqual([100, '100%']);
    expect(v.levelOrder.map((i) => exitHeadingText(i + 1, v.levels[i].qty, v.levels[i].percent, AAPL))).toEqual([
      'Exit 1 · 50 shares · 50%',
      'Exit 2 · 25 shares · 25%',
      'Exit 3 · 25 shares · 25%',
    ]);
    expect(levelRowParts(three, v, 0, AAPL)).toEqual([
      { label: 'TP', text: '50 @ 206.00', tone: 'normal' },
      { label: 'SL', text: '50 @ 197.50', tone: 'normal' },
    ]);
    expect(text(three)).toBe('SL −407.00 USD · TP up to +818.00 USD · 3 exits');
    expect(summaryParts(v, AAPL)?.map((p) => p.kind)).toEqual(['sl', 'tp', 'exits']);
  });
  it('the draft carries one exit level per level, in data order', () => {
    expect(nv(three).draft?.exitLevels).toEqual([
      { qty: 50, takeProfit: 206, stopLoss: 197.5 },
      { qty: 25, takeProfit: 211, stopLoss: 197.5 },
      { qty: 25, takeProfit: 216, stopLoss: 197.5 },
    ]);
  });
  it('rows are ordered by take profit, nearest first (Buy ascending, Sell descending), no TP last', () => {
    const s = { ...base, levels: [lv(0.25, '216.00', '197.50'), lv(0.25, '', '197.50'), lv(0.25, '206.00', '197.50'), lv(0.25, '211.00', '197.50')] };
    expect(nv(s).levelOrder).toEqual([2, 3, 0, 1]);
    const sell = { ...three, side: 'sell' as const, levels: [lv(0.5, '190.00', '205.00'), lv(0.5, '195.00', '205.00')] };
    expect(nv(sell).levelOrder).toEqual([1, 0]);
  });
  it('a leg that is off reads "TP off" / "SL off" (SL off in orange); the summary skips it', () => {
    const s = { ...base, levels: [lv(0.5, '', '197.50'), lv(0.5, '211.00', '')] };
    const v = nv(s);
    expect(levelRowParts(s, v, 0, AAPL)).toEqual([
      { label: 'TP', text: 'off', tone: 'off' },
      { label: 'SL', text: '50 @ 197.50', tone: 'normal' },
    ]);
    expect(levelRowParts(s, v, 1, AAPL)[1]).toEqual({ label: 'SL', text: 'off', tone: 'off' });
    expect(text(s)).toBe('SL −203.50 USD · TP +471.50 USD · 2 exits');
  });
  it('shares not covered by a level: "20 shares without SL/TP" (orange); the bar is below 100%', () => {
    const s = { ...base, levels: [lv(0.8, '211.00', '197.50'), lv(0, '', '')] };
    const v = nv(s);
    expect([v.protectedQty, v.protectedPercent]).toEqual([80, 80]);
    expect(text(s)).toBe('SL −325.60 USD · TP +754.40 USD · 2 exits · 20 shares without SL/TP');
    expect(summaryParts(v, AAPL)?.at(-1)).toMatchObject({ kind: 'warning', amount: '20 shares without SL/TP' });
  });
  it('take profits without any stop loss: "No stop loss" instead of an SL segment', () => {
    const one = { ...st({ qtyInput: '100', tp: on('price', '211.00') }) };
    expect(text(one)).toBe('TP +943.00 USD · No stop loss');
    const s = { ...base, levels: [lv(0.5, '206.00', ''), lv(0.5, '211.00', '')] };
    expect(text(s)).toBe('TP up to +693.00 USD · 2 exits · No stop loss');
  });
  it('Sell 100 @ Bid 201.56, SL 205.00, TP 195.00 → "SL −344.00 USD · TP +656.00 USD"', () => {
    expect(text(st({ side: 'sell', qtyInput: '100', sl: on('price', '205.00'), tp: on('price', '195.00') }))).toBe('SL −344.00 USD · TP +656.00 USD');
  });
  it('exits above the order: caption under the list and "Reduce exits to 100 shares" on the button', () => {
    const s = { ...base, levels: [lv(0.7, '206.00', '197.50'), lv(0.5, '211.00', '197.50')] };
    const v = nv(s);
    expect([v.protectedQty, v.exitsCaption, v.exitsError, v.canSubmit]).toEqual([120, 'Exits exceed the order by 20 shares', 'Reduce exits to 100 shares', false]);
    expect(submitText(s, v, AAPL)).toMatchObject({ secondary: 'Reduce exits to 100 shares', disabled: true });
  });
  it('a stop loss / take profit on the wrong side: the leg is red, the button says why', () => {
    const slWrong = { ...base, levels: [lv(0.5, '206.00', '202.00'), lv(0.5, '211.00', '197.50')] };
    const v = nv(slWrong);
    expect(levelRowParts(slWrong, v, 0, AAPL)[1]).toMatchObject({ label: 'SL', tone: 'error' });
    expect(submitText(slWrong, v, AAPL)).toMatchObject({ secondary: 'Stop loss must be below entry', disabled: true });
    const tpWrong = { ...base, levels: [lv(0.5, '190.00', '197.50'), lv(0.5, '211.00', '197.50')] };
    expect(submitText(tpWrong, nv(tpWrong), AAPL).secondary).toBe('Take profit must be above entry');
    const sellWrong = { ...base, side: 'sell' as const, levels: [lv(0.5, '190.00', '197.50'), lv(0.5, '195.00', '205.00')] };
    expect(submitText(sellWrong, nv(sellWrong), AAPL).secondary).toBe('Stop loss must be above entry');
  });
  it('the order quantity changes: the levels keep their shares (99 → 51 / 24 / 24, 100 → 50 / 25 / 25), nothing drifts', () => {
    const q = (n: string) => nv({ ...three, qtyInput: n }).levels.map((l) => l.qty);
    expect([q('100'), q('99'), q('100')]).toEqual([[50, 25, 25], [51, 24, 24], [50, 25, 25]]);
  });
  it('risk sizing with levels uses the share-weighted stop distance', () => {
    const s = { ...three, qtyUnit: 'riskMoney' as const, qtyInput: '400', levels: [lv(0.5, '206.00', '197.50'), lv(0.5, '211.00', '195.50')] };
    // distances 4.07 and 6.07, equal shares → 5.07 → floor(400 / 5.07) = 78
    expect(nv(s).qty.units).toBe(78);
  });
  it('level texts', () => {
    const v = nv(three);
    expect(orderTitleText(base, v, AAPL)).toBe('Buy Market 100 @ 201.57');
    expect([levelPercentText(50), levelPercentText(33.33), levelPercentText(0.24)]).toEqual(['50%', '33.33%', '0.24%']);
    expect(exitHeadingText(1, 1, 1, AAPL)).toBe('Exit 1 · 1 share · 1%');
    expect(levelMenuValue('ticks', { unit: 'price', input: '206.00' }, v.levels[0].tp.level, true, AAPL)).toBe('443');
  });
  it('rows show the typed price before an entry price exists', () => {
    const s = st({ type: 'limit', qtyInput: '', levels: [lv(0.5, '206.96', '195.02'), lv(0.5, '', '195.02')] });
    const v = nv(s);
    expect(levelRowParts(s, v, 0, AAPL).map((p) => p.text)).toEqual(['0 @ 206.96', '0 @ 195.02']);
    expect(orderTitleText(s, v, AAPL)).toBe('Buy Limit');
  });
});

describe('Block 6. Market closed', () => {
  it('banner text and "· at open" for Market; draft queued', () => {
    const opensAt = new Date(2026, 9, 12, 15, 30).getTime(); // Monday
    expect(marketClosedText(opensAt)).toBe('Market is closed · opens Mon 15:30');
    const s = st({ qtyInput: '100' });
    const v = nv(s, { opensAt });
    expect(submitText(s, v, AAPL).secondary).toBe('100 AAPL · MKT · at open');
    expect(v.draft?.activateAt).toBe(opensAt);
    const l = st({ type: 'limit', priceInput: '199', qtyInput: '100' });
    expect(submitText(l, nv(l, { opensAt }), AAPL).secondary).toBe('100 AAPL · LMT 199.00 · till Oct 15');
  });
});

describe('Block 7. Placed toast', () => {
  it('"Buy limit 100 AAPL at 199.00 placed"', () => {
    expect(placedToastText('buy', 'limit', 100, 199, AAPL)).toBe('Buy limit 100 AAPL at 199.00 placed');
    expect(placedToastText('sell', 'stop', 10, 205, AAPL)).toBe('Sell stop 10 AAPL at 205.00 placed');
  });
});

// ---------------------------------------------------------------------------
// PRD "Меню единиц: живые значения справа" — one test per table row (both columns) + its ⓘ text.
// ---------------------------------------------------------------------------

describe('Unit menus: live values (PRD table)', () => {
  const nctx: TicketContext = { ...ctx, rules: NEW_RULES };
  const market = st({ qtyInput: '100', sl: on('price', '197.50'), tp: on('price', '211.00') });
  const limit = st({ type: 'limit', priceInput: '199.00', qtyInput: '100', sl: on('price', '195.00'), tp: on('price', '207.00') });
  type Row =
    | ['qty', QtyUnit, string, string, string | undefined]
    | ['sl' | 'tp', ExitUnit, string, string, string | undefined];
  const rows: Row[] = [
    ['qty', 'units', '100', '100', undefined],
    ['qty', 'value', '20,157.00', '19,900.00', 'Shares × entry price'],
    ['qty', 'balancePercent', '20.17%', '19.91%', 'Position value as % of balance'],
    ['qty', 'riskMoney', '407.00', '400.00', 'Shares × distance to SL'],
    ['qty', 'riskBalancePercent', '0.41%', '0.40%', 'Risk as % of balance'],
    ['sl', 'price', '197.50', '195.00', undefined],
    ['sl', 'ticks', '407', '400', 'Distance from entry in ticks'],
    ['sl', 'percent', '2.02%', '2.01%', 'Distance from entry as % of price'],
    ['sl', 'money', '407.00', '400.00', 'Loss if triggered'],
    ['sl', 'balancePercent', '0.41%', '0.40%', 'Loss as % of balance'],
    ['tp', 'price', '211.00', '207.00', undefined],
    ['tp', 'ticks', '943', '800', 'Distance from entry in ticks'],
    ['tp', 'percent', '4.68%', '4.02%', 'Distance from entry as % of price'],
    ['tp', 'money', '943.00', '800.00', 'Profit if triggered'],
    ['tp', 'balancePercent', '0.94%', '0.80%', 'Profit as % of balance'],
  ];
  const value = (menu: Row[0], unit: string, s: TicketState) => {
    const v = deriveTicket(s, nctx);
    if (menu === 'qty') return qtyMenuValue(unit as QtyUnit, s, v, AAPL);
    return exitMenuValue(menu, unit as ExitUnit, s, v, AAPL);
  };
  const info = (menu: Row[0], unit: string) =>
    menu === 'qty' ? qtyUnitInfo(unit as QtyUnit, AAPL) : exitUnitInfo(menu, unit as ExitUnit);
  it.each(rows)('%s · %s → Market %s · Limit %s', (menu, unit, m, l, i) => {
    expect([value(menu, unit, market), value(menu, unit, limit), info(menu, unit)]).toEqual([m, l, i]);
  });

  it('Sell: Ticks from Bid, values without a sign', () => {
    const s = st({ side: 'sell', type: 'limit', priceInput: '203.00', qtyInput: '100', sl: on('price', '205.00') });
    const v = deriveTicket(s, nctx);
    expect([exitMenuValue('sl', 'ticks', s, v, AAPL), exitMenuValue('sl', 'money', s, v, AAPL), exitMenuValue('sl', 'percent', s, v, AAPL)]).toEqual([
      '200',
      '200.00',
      '0.99%',
    ]);
  });
  it('the selected unit keeps the typed value; the others are recalculated', () => {
    const s = st({ qtyUnit: 'value', qtyInput: '20000' });
    const v = deriveTicket(s, nctx);
    expect([qtyMenuValue('value', s, v, AAPL), qtyMenuValue('units', s, v, AAPL), qtyMenuValue('balancePercent', s, v, AAPL)]).toEqual([
      '20,000.00',
      '99',
      '19.96%',
    ]);
  });
  it('risk modes: the risk items convert the typed risk, not the actual one (400.00 for 400)', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '400', sl: on('price', '197.50') });
    const v = deriveTicket(s, nctx);
    expect([qtyMenuValue('riskMoney', s, v, AAPL), qtyMenuValue('riskBalancePercent', s, v, AAPL), qtyMenuValue('units', s, v, AAPL)]).toEqual([
      '400.00',
      '0.40%',
      '98',
    ]);
    const p = st({ qtyUnit: 'riskBalancePercent', qtyInput: '0.5', sl: on('price', '197.50') });
    const pv = deriveTicket(p, nctx);
    expect([qtyMenuValue('riskBalancePercent', p, pv, AAPL), qtyMenuValue('riskMoney', p, pv, AAPL)]).toEqual(['0.50%', '499.77']);
  });
  it('both menus list all five units; SL disables the Risk ones in risk modes (see "Risk sizing blocks…")', () => {
    expect(exitUnitsFor()).toEqual(EXITS);
  });
  it('cannot compute: "—"; risk items without SL: "Needs SL"', () => {
    const empty = st();
    const v = deriveTicket(empty, nctx);
    expect(QTY.map((u) => qtyMenuValue(u, empty, v, AAPL))).toEqual([DASH, DASH, DASH, 'Needs SL', 'Needs SL']);
    expect(EXITS.map((u) => exitMenuValue('sl', u, empty, v, AAPL))).toEqual([DASH, DASH, DASH, DASH, DASH]);
    const noQty = st({ sl: on('price', '197.50') });
    const nv = deriveTicket(noQty, nctx);
    expect(EXITS.map((u) => exitMenuValue('sl', u, noQty, nv, AAPL))).toEqual(['197.50', '407', '2.02%', DASH, DASH]);
  });
});
const QTY: QtyUnit[] = ['units', 'value', 'balancePercent', 'riskMoney', 'riskBalancePercent'];
const EXITS: ExitUnit[] = ['price', 'ticks', 'percent', 'money', 'balancePercent'];

describe('Live placeholders', () => {
  const nctx: TicketContext = { ...ctx, rules: NEW_RULES };
  it.each<[string, Partial<TicketState>, string, string]>([
    ['Buy Limit: below Ask', { type: 'limit' }, '199.00', 'Ask − 2.57'],
    ['Sell Limit: above Bid', { type: 'limit', side: 'sell' }, '204.00', 'Bid + 2.44'],
    ['Buy Stop: above Ask', { type: 'stop' }, '205.00', 'Ask + 3.43'],
    ['Sell Stop: below Bid', { type: 'stop', side: 'sell' }, '198.00', 'Bid − 3.56'],
  ])('price placeholder of an empty field, %s: Limit 1%% / Stop 1.5%% on a round step — a click substitutes it, no warning', (_, p, price, right) => {
    const s = st(p);
    const t = priceText(s, deriveTicket(s, nctx), AAPL);
    expect([t.placeholder, t.fill, t.right, t.rightTone]).toEqual([price, price, right, 'muted']);
    const filled = committed({ ...s, priceInput: t.fill });
    expect(priceWarning(filled.side, deriveTicket(filled, nctx))).toBeNull();
  });
  it('price placeholder in offset mode: −2.57, grey price on the right; 0 is the market', () => {
    const off = st({ type: 'limit', priceUnit: 'offset' });
    expect(priceText(off, deriveTicket(off, nctx), AAPL)).toMatchObject({ placeholder: '−2.57', fill: '−2.57', right: '199.00', rightTone: 'muted' });
    const sell = st({ type: 'stop', side: 'sell', priceUnit: 'offset' });
    expect(priceText(sell, deriveTicket(sell, nctx), AAPL)).toMatchObject({ placeholder: '−3.56', right: '198.00' });
    const zero = st({ type: 'limit', priceUnit: 'offset', priceInput: '0' });
    expect(deriveTicket(zero, nctx).price!.value).toBe(201.57);
  });
  it.each<[QtyUnit, string, string, string]>([
    ['units', '1', '1', '201.57 USD'],
    ['value', '201.57', '201.57', '1 share'],
    ['balancePercent', '0.20', '0.21', '1 share'],
  ])('quantity in %s: placeholder %s, click substitutes %s, right %s', (unit, placeholder, fill, right) => {
    const s = st({ qtyUnit: unit });
    const v = deriveTicket(s, nctx);
    expect(qtyPlaceholder(s, v, AAPL)).toEqual({ placeholder, fill, right });
    // The substituted value buys exactly the minimum quantity.
    expect(deriveTicket({ ...s, qtyInput: fill }, nctx).qty.units).toBe(1);
  });
  it('quantity in risk modes: the default risk, 1% of balance (1,000 USD / 1.00%); without SL "—"', () => {
    const s = st({ qtyUnit: 'riskMoney', sl: on('price', '197.50') });
    const v = deriveTicket(s, nctx);
    expect(qtyPlaceholder(s, v, AAPL)).toEqual({ placeholder: '1,000.00', fill: '1000', right: '' });
    expect(deriveTicket({ ...s, qtyInput: '1000' }, nctx).qty.units).toBe(245);
    const p = st({ qtyUnit: 'riskBalancePercent', sl: on('price', '197.50') });
    expect(qtyPlaceholder(p, deriveTicket(p, nctx), AAPL)).toMatchObject({ placeholder: '1.00', fill: '1.00' });
    const noSl = st({ qtyUnit: 'riskMoney' });
    expect(qtyText(noSl, deriveTicket(noSl, nctx), AAPL).right).toBe('—');
  });
  it('no quantity: button "Enter quantity to buy AAPL", no money on SL / TP', () => {
    const s = st({ sl: on('price', '197.50'), tp: on('price', '211.00') });
    const v = deriveTicket(s, nctx);
    expect(submitText(s, v, AAPL).secondary).toBe('Enter quantity to buy AAPL');
    expect([exitText('sl', s, v, AAPL).right, exitText('tp', s, v, AAPL).right]).toEqual(['', '']);
  });
});

describe('Switched-off SL / TP: numeric placeholder (FR-6.3)', () => {
  const nctx: TicketContext = { ...ctx, rules: NEW_RULES };
  const offView = (s: TicketState) => {
    const v = deriveTicket(s, nctx);
    return [v.sl.placeholder, exitText('sl', s, v, AAPL).right, v.tp.placeholder, exitText('tp', s, v, AAPL).right];
  };
  it('Market Buy, Ask 201.57, 100 sh: SL 197.54 / −403.00 USD, TP 209.63 / +806.00 USD', () => {
    expect(offView(st({ qtyInput: '100' }))).toEqual(['197.54', '−403.00 USD', '209.63', '+806.00 USD']);
  });
  it('Limit 199.00: SL 195.02 / −398.00 USD, TP 206.96 / +796.00 USD', () => {
    expect(offView(st({ type: 'limit', priceInput: '199.00', qtyInput: '100' }))).toEqual(['195.02', '−398.00 USD', '206.96', '+796.00 USD']);
  });
  it('limit without a price counts from the price placeholder (199.00); no quantity → no money', () => {
    expect(offView(st({ type: 'limit' }))).toEqual(['195.02', '', '206.96', '']);
  });
  it('Sell mirrors: SL above, TP below Bid 201.56', () => {
    expect(offView(st({ side: 'sell', qtyInput: '100' }))).toEqual(['205.59', '−403.00 USD', '193.50', '+806.00 USD']);
  });
  it('placeholder in the current unit; grey, no caption, no R:R, not in the summary', () => {
    const s = st({ qtyInput: '100', sl: { ...off, unit: 'ticks' }, tp: { ...off, unit: 'percent' } });
    const v = deriveTicket(s, nctx);
    expect([v.sl.placeholder, v.tp.placeholder]).toEqual(['403', '4.00']);
    expect(exitText('sl', s, v, AAPL)).toMatchObject({ right: '−403.00 USD', rightTone: 'muted', caption: null });
    expect([v.riskReward, summaryText(v, AAPL), v.draft?.stopLoss, v.draft?.takeProfit]).toEqual([null, null, undefined, undefined]);
  });
  it('money units without quantity have no numeric placeholder', () => {
    const s = st({ sl: { ...off, unit: 'money' } });
    expect(deriveTicket(s, nctx).sl.placeholder).toBe('');
  });
  it('switched off after editing: the last value stays the placeholder', () => {
    const s = st({ qtyInput: '100', sl: { ...off, input: '199.00' } });
    const v = deriveTicket(s, nctx);
    expect([v.sl.placeholder, exitText('sl', s, v, AAPL).right]).toEqual(['199.00', '−257.00 USD']);
  });
});

describe('"Fills now" / "Triggers now": at or beyond the market, from the committed status', () => {
  const warn = (s: TicketState) => priceWarning(s.side, deriveTicket(committed(s), nctx));
  it.each<[string, Partial<TicketState>, string | null]>([
    ['Buy Limit below Ask', { type: 'limit', priceInput: '201.56' }, null],
    ['Buy Limit at Ask', { type: 'limit', priceInput: '201.57' }, 'Fills now: price is above Ask'],
    ['Sell Limit above Bid', { type: 'limit', side: 'sell', priceInput: '201.57' }, null],
    ['Sell Limit at Bid', { type: 'limit', side: 'sell', priceInput: '201.56' }, 'Fills now: price is below Bid'],
    ['Buy Stop above Ask', { type: 'stop', priceInput: '201.58' }, null],
    ['Buy Stop at Ask', { type: 'stop', priceInput: '201.57' }, 'Triggers now: price is below Ask'],
    ['Sell Stop below Bid', { type: 'stop', side: 'sell', priceInput: '201.55' }, null],
    ['Sell Stop at Bid', { type: 'stop', side: 'sell', priceInput: '201.56' }, 'Triggers now: price is above Bid'],
  ])('%s', (_, p, expected) => expect(warn(st(p))).toBe(expected));
  it('not evaluated on ticks: the view keeps the committed status whatever the market does', () => {
    const s = st({ type: 'limit', priceInput: '201.60' }); // committed 'ok' before the market rose above 201.60
    expect(priceWarning(s.side, nv(s))).toBeNull();
    expect(priceText(s, nv(s), AAPL).rightTone).toBe('neutral');
  });
  it('the "Ask − 2.57" label can use a throttled quote', () => {
    const s = st({ type: 'limit', priceInput: '199.00' });
    expect(priceText(s, nv(s), AAPL, { bid: 201.4, ask: 201.41 }).right).toBe('Ask − 2.41');
  });
});

describe('Risk sizing blocks money units in the stop loss', () => {
  it('Risk USD / Risk % balance in quantity → SL Risk USD / Risk % balance are disabled with a reason; the TP menu does not change', () => {
    const s = st({ qtyUnit: 'riskMoney' });
    expect(EXITS.map((u) => exitUnitBlocked('tp', u, s))).toEqual([null, null, null, null, null]);
    expect(EXITS.map((u) => exitUnitBlocked('sl', u, s))).toEqual([
      null,
      null,
      null,
      'Not available while quantity is in Risk USD',
      'Not available while quantity is in Risk USD',
    ]);
    expect(exitUnitBlocked('sl', 'balancePercent', st({ qtyUnit: 'riskBalancePercent' }))).toBe('Not available while quantity is in Risk % balance');
    expect(EXITS.map((u) => exitUnitBlocked('sl', u, st({ qtyUnit: 'value' })))).toEqual([null, null, null, null, null]);
  });
});

describe('Colours: money in the SL / TP fields is grey, the summary colours the labels', () => {
  const s = st({ qtyInput: '100', sl: on('price', '197.50'), tp: on('price', '211.00') });
  const v = deriveTicket(s, { ...ctx, rules: NEW_RULES });
  it('SL / TP money on the right is neutral (grey), not red / green', () => {
    expect(exitText('sl', s, v, AAPL)).toMatchObject({ right: '−407.00 USD', rightTone: 'neutral' });
    expect(exitText('tp', s, v, AAPL)).toMatchObject({ right: '+943.00 USD', rightTone: 'neutral' });
  });
  it('summary parts: SL and TP with their money; text form joins them with " · "', () => {
    expect(summaryParts(v, AAPL)).toEqual([
      { label: 'SL', amount: '−407.00 USD', kind: 'sl' },
      { label: 'TP', prefix: undefined, amount: '+943.00 USD', kind: 'tp' },
    ]);
    expect(summaryText(v, AAPL)).toBe('SL −407.00 USD · TP +943.00 USD');
  });
  it('no exits → no summary', () => {
    expect(summaryParts(deriveTicket(st({ qtyInput: '100' }), { ...ctx, rules: NEW_RULES }), AAPL)).toBeNull();
  });
});
