import { describe, expect, it } from 'vitest';
import { getSpec } from '../../config/symbols';
import type { Quote } from '../../market/types';
import { deriveTicket, type TicketContext } from '../../order-ticket/deriveTicket';
import type { ExitState, TicketState } from '../../order-ticket/types';
import { exitText, formatExitInput, formatQtyInput, qtyText, riskRewardText, submitText, summaryText, tifText } from './presenters';

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
    qtyUnit: 'units',
    qtyInput: '',
    sl: off,
    tp: off,
    tif: 'week',
    gtdDate: '',
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
    expect(qtyText(s, v, AAPL)).toMatchObject({ caption: 'Not enough margin · Available 100.00 USD', captionTone: 'error' });
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
