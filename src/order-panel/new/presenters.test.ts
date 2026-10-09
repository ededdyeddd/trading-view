import { describe, expect, it } from 'vitest';
import { getSpec } from '../../config/symbols';
import type { Quote } from '../../market/types';
import { NEW_RULES, deriveTicket, type TicketContext } from '../../order-ticket/deriveTicket';
import type { ExitState, TicketState } from '../../order-ticket/types';
import {
  exitText,
  formatExitInput,
  formatQtyInput,
  marketClosedText,
  percentLeftText,
  placedToastText,
  priceText,
  qtyText,
  riskRewardText,
  submitText,
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
    qtyUnit: 'units',
    qtyInput: '',
    sl: off,
    tp: off,
    tif: 'week',
    gtdDate: '',
    gtdTime: '',
    tpPercent: '',
    tpLevels: [],
    fillOutsideRth: false,
    ...p,
  };
}
const on = (unit: ExitState['unit'], input: string): ExitState => ({ enabled: true, unit, input, touched: true });

describe('Quantity table', () => {
  it('empty → 0 · 0.00 USD · Available margin', () => {
    const s = st();
    const t = qtyText(s, deriveTicket(s, ctx), AAPL);
    expect([t.right, t.caption]).toEqual(['0.00 USD', 'Available margin 99,953.90 USD']);
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
      'USD',
      '99 shares',
      'Margin 399.11 USD · Tick 0.99 USD',
    ]);
  });
  it('% balance 20 % → 99 shares · Margin 399.11 USD · Tick 0.99 USD', () => {
    const s = st({ qtyUnit: 'balancePercent', qtyInput: '20' });
    const t = qtyText(s, deriveTicket(s, ctx), AAPL);
    expect([formatQtyInput('20', 'balancePercent', AAPL), t.suffix, t.right, t.caption]).toEqual(['20', '%', '99 shares', 'Margin 399.11 USD · Tick 0.99 USD']);
  });
});

describe('Stop loss table (entry 201.57, 100 shares)', () => {
  const rows: [ExitState['unit'], string, string, string, string][] = [
    ['price', '197.50', '197.50', '−407.00 USD', '−4.07 (−2.02%) from entry'],
    ['ticks', '407', '407 ticks', '−407.00 USD', 'At 197.50 · −2.02% from entry'],
    ['percent', '2.02', '2.02 % of price', '−407.00 USD', 'At 197.50 · −4.07 from entry'],
    ['money', '407', '407.00 USD', '197.50', '−4.07 (−2.02%) from entry'],
    ['balancePercent', '0.4072', '0.41 % of balance', '−407.00 USD', 'At 197.50 · −4.07 (−2.02%) from entry'],
  ];
  it.each(rows)('%s', (unit, input, left, right, caption) => {
    const s = st({ qtyInput: '100', sl: on(unit, input) });
    const t = exitText('sl', s, deriveTicket(s, ctx), AAPL);
    const shownLeft =
      unit === 'balancePercent' ? `${Number(input).toFixed(2)} ${t.suffix}` : `${formatExitInput(input, unit, AAPL)}${t.suffix ? ` ${t.suffix}` : ''}`;
    expect([shownLeft, t.right, t.caption]).toEqual([left, right, caption]);
  });
});

describe('Take profit table (mirror)', () => {
  const rows: [ExitState['unit'], string, string, string, string][] = [
    ['price', '211.00', '211.00', '+943.00 USD', '+9.43 (+4.68%) from entry'],
    ['ticks', '943', '943 ticks', '+943.00 USD', 'At 211.00 · +4.68% from entry'],
    ['percent', '4.68', '4.68 % of price', '+943.00 USD', 'At 211.00 · +9.43 from entry'],
    ['money', '943', '943.00 USD', '211.00', '+9.43 (+4.68%) from entry'],
    ['balancePercent', '0.9434', '0.94 % of balance', '+943.00 USD', 'At 211.00 · +9.43 (+4.68%) from entry'],
  ];
  it.each(rows)('%s', (unit, input, left, right, caption) => {
    const s = st({ qtyInput: '100', tp: on(unit, input) });
    const t = exitText('tp', s, deriveTicket(s, ctx), AAPL);
    const shownLeft =
      unit === 'balancePercent' ? `${Number(input).toFixed(2)} ${t.suffix}` : `${formatExitInput(input, unit, AAPL)}${t.suffix ? ` ${t.suffix}` : ''}`;
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
    expect(summaryText(view(s))).toBeNull();
    expect(submitText(s, view(s), AAPL)).toEqual({
      primary: 'Buy',
      secondary: 'Enter quantity to buy AAPL',
      disabled: true,
      reason: 'Enter quantity to buy AAPL',
    });
  });
  it('quantity, no exits', () => {
    const s = st({ qtyInput: '100' });
    expect(summaryText(view(s))).toBeNull();
    expect(submitText(s, view(s), AAPL)).toMatchObject({ primary: 'Buy', secondary: '100 AAPL · MKT', disabled: false });
  });
  it('SL and TP', () => {
    const s = st({ qtyInput: '100', sl: on('price', '197.50'), tp: on('price', '211.00') });
    expect(summaryText(view(s))).toBe('SL −407.00 USD · TP +943.00 USD');
    expect(submitText(s, view(s), AAPL).secondary).toBe('100 AAPL · MKT');
    expect(riskRewardText(view(s).riskReward!)).toBe('1 : 2.32');
  });
  it('one exit', () => {
    const s = st({ qtyInput: '100', sl: on('price', '197.50') });
    expect(summaryText(view(s))).toBe('SL −407.00 USD');
  });
  it('SL on the wrong side', () => {
    const s = st({ qtyInput: '100', sl: on('price', '205') });
    expect(summaryText(view(s))).toBeNull();
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

describe('Block 1. Limit Price', () => {
  it('empty: placeholder = current Ask, no right value; button "Enter price and quantity"', () => {
    const s = st({ type: 'limit' });
    const p = priceText(s, nv(s), AAPL);
    expect([p.placeholder, p.right, p.caption]).toEqual(['201.57', '', null]);
    expect(submitText(s, nv(s), AAPL).secondary).toBe('Enter price and quantity');
  });
  it('Price 199.00 → Ask − 2.57', () => {
    const s = st({ type: 'limit', priceInput: '199.00' });
    expect(priceText(s, nv(s), AAPL)).toMatchObject({ right: 'Ask − 2.57', rightTone: 'neutral', caption: null });
  });
  it('Ticks from Ask: 257 ticks below → 199.00', () => {
    const s = st({ type: 'limit', priceUnit: 'ticks', priceInput: '257' });
    const v = nv(s);
    expect(priceText(s, v, AAPL)).toMatchObject({ suffix: 'ticks below', right: '199.00' });
    expect(v.entry).toBe(199);
  });
  it('Buy Limit above Ask: orange "Ask + 0.07", "Fills now: price is above Ask", button stays active', () => {
    const s = st({ type: 'limit', priceInput: '201.64', qtyInput: '100' });
    const v = nv(s);
    expect(priceText(s, v, AAPL)).toMatchObject({
      right: 'Ask + 0.07',
      rightTone: 'warning',
      caption: 'Fills now: price is above Ask',
      captionTone: 'warning',
    });
    expect(submitText(s, v, AAPL).disabled).toBe(false);
  });
  it('Sell Limit counts from Bid; warning below Bid', () => {
    const s = st({ type: 'limit', side: 'sell', priceInput: '205.00' });
    expect(priceText(s, nv(s), AAPL).right).toBe('Bid + 3.44');
    const s2 = st({ type: 'limit', side: 'sell', priceInput: '201.00' });
    expect(priceText(s2, nv(s2), AAPL)).toMatchObject({ caption: 'Fills now: price is below Bid', captionTone: 'warning' });
  });
  it('limit entry anchors exits: SL/TP from 199.00 (Figma Limit · Filled)', () => {
    const s = st({ type: 'limit', priceInput: '199.00', qtyInput: '100', sl: on('price', '195.00'), tp: on('price', '207.00') });
    const v = nv(s);
    expect(qtyText(s, v, AAPL)).toMatchObject({ right: '19,900.00 USD', caption: 'Margin 398.00 USD · Tick 1.00 USD' });
    expect(exitText('sl', s, v, AAPL)).toMatchObject({ right: '−400.00 USD', caption: '−4.00 (−2.01%) from entry' });
    expect(exitText('tp', s, v, AAPL)).toMatchObject({ right: '+800.00 USD', caption: '+8.00 (+4.02%) from entry' });
    expect(riskRewardText(v.riskReward!)).toBe('1 : 2.00');
    expect(summaryText(v)).toBe('SL −400.00 USD · TP +800.00 USD');
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
    const s = st({ type: 'stop', priceInput: '201.00', qtyInput: '100' });
    const v = nv(s);
    expect(priceText(s, v, AAPL)).toMatchObject({ caption: 'Triggers now: price is below Ask', captionTone: 'warning' });
    expect(v.canSubmit).toBe(true);
  });
  it('Sell Stop above Bid: "Triggers now: price is above Bid"', () => {
    const s = st({ type: 'stop', side: 'sell', priceInput: '202.00' });
    expect(priceText(s, nv(s), AAPL).caption).toBe('Triggers now: price is above Bid');
  });
});

describe('Block 3. Risk modes', () => {
  it('Risk USD 400 at Market with SL 197.50 → 98 shares · Real risk 398.86 USD · Margin 395.08 USD', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '400', sl: on('price', '197.50') });
    const t = qtyText(s, nv(s), AAPL);
    expect([formatQtyInput('400', 'riskMoney', AAPL), t.suffix, t.right, t.caption]).toEqual([
      '400.00',
      'USD',
      '98 shares',
      'Real risk 398.86 USD · Margin 395.08 USD',
    ]);
  });
  it('Risk % balance 0.5 → 122 shares · Real risk 496.54 USD · Margin 491.83 USD', () => {
    const s = st({ qtyUnit: 'riskBalancePercent', qtyInput: '0.5', sl: on('price', '197.50') });
    const t = qtyText(s, nv(s), AAPL);
    expect([formatQtyInput('0.5', 'riskBalancePercent', AAPL), t.suffix, t.right, t.caption]).toEqual([
      '0.5',
      '% of balance',
      '122 shares',
      'Real risk 496.54 USD · Margin 491.83 USD',
    ]);
  });
  it('main case: Buy Limit 199.00, Risk USD 400, SL 195.00, TP 207.00 → 100 shares, R:R 1 : 2.00', () => {
    const s = st({ type: 'limit', priceInput: '199.00', qtyUnit: 'riskMoney', qtyInput: '400', sl: on('price', '195.00'), tp: on('price', '207.00') });
    const v = nv(s);
    expect(v.qty.units).toBe(100);
    expect(qtyText(s, v, AAPL).caption).toBe('Real risk 400.00 USD · Margin 398.00 USD');
    expect(riskRewardText(v.riskReward!)).toBe('1 : 2.00');
    expect(submitText(s, v, AAPL).secondary).toBe('100 AAPL · LMT 199.00 · till Oct 15');
    expect(v.draft).toMatchObject({ side: 'buy', type: 'limit', qty: 100, limitPrice: 199, stopLoss: 195, takeProfit: 207, tif: 'week' });
  });
  it('SL off: "—", link "Turn on stop loss to calculate shares", button "Set stop loss to calculate size"', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '400' });
    const v = nv(s);
    expect(qtyText(s, v, AAPL)).toMatchObject({ right: '—', caption: 'Turn on stop loss to calculate shares', captionAction: 'enable-sl' });
    expect(submitText(s, v, AAPL)).toMatchObject({ secondary: 'Set stop loss to calculate size', disabled: true });
  });
  it('risk below one share: "Risk is below 1 share (4.07 USD)"', () => {
    const s = st({ qtyUnit: 'riskMoney', qtyInput: '3', sl: on('price', '197.50') });
    const v = nv(s);
    expect(qtyText(s, v, AAPL)).toMatchObject({ caption: 'Risk is below 1 share (4.07 USD)', captionTone: 'error' });
    expect(submitText(s, v, AAPL)).toMatchObject({ secondary: 'Risk is below 1 share', disabled: true });
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

describe('Block 5. Take-profit levels', () => {
  it('3 levels: summary sums TP money; R:R by weighted TP; "12% left"', () => {
    const s = st({
      type: 'limit',
      priceInput: '199.00',
      qtyInput: '100',
      sl: on('price', '195.00'),
      tp: on('price', '205.00'),
      tpPercent: '30',
      tpLevels: [
        { input: '207.00', percent: '30' },
        { input: '209.00', percent: '28' },
      ],
    });
    const v = nv(s);
    expect(v.tpLevels.map((l) => l.qty)).toEqual([30, 30, 28]);
    expect(v.tpMoney).toBe(30 * 6 + 30 * 8 + 28 * 10);
    expect(summaryText(v)).toBe('SL −400.00 USD · TP +700.00 USD (3 levels)');
    expect(percentLeftText(v)).toBe('12% left');
    // weighted TP distance = (6·30 + 8·30 + 10·28) / 88
    expect(v.riskReward).toBeCloseTo((6 * 30 + 8 * 30 + 10 * 28) / 88 / 4, 9);
    expect(v.draft?.takeProfits).toEqual([
      { price: 205, qty: 30 },
      { price: 207, qty: 30 },
      { price: 209, qty: 28 },
    ]);
  });
  it('default split is equal', () => {
    const s = st({ qtyInput: '100', tp: on('price', '205.00'), tpLevels: [{ input: '207', percent: '' }] });
    expect(nv(s).tpLevels.map((l) => l.percent)).toEqual([50, 50]);
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
