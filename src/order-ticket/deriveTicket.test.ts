import { describe, expect, it } from 'vitest';
import { getSpec } from '../config/symbols';
import type { Quote } from '../market/types';
import { deriveTicket, type TicketContext } from './deriveTicket';
import type { TicketState } from './types';

const AAPL = getSpec('AAPL');
const NOW = new Date(2026, 9, 8, 12, 0, 0).getTime();
const quote: Quote = { symbol: 'AAPL', bid: 201.56, ask: 201.57, last: 201.57, ts: NOW };
const ctx: TicketContext = { quote, spec: AAPL, balance: 99_953.9, availableFunds: 99_953.9, now: NOW };

function state(p: Partial<TicketState> = {}): TicketState {
  return {
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    priceInput: '',
    priceUnit: 'price',
    priceStatus: 'ok',
    qtyUnit: 'units',
    qtyInput: '100',
    tp: { enabled: false, unit: 'price', input: '', touched: false },
    sl: { enabled: false, unit: 'ticks', input: '25', touched: true },
    tif: 'week',
    gtdDate: '',
    gtdTime: '',
    partials: [],
    fillOutsideRth: false,
    ...p,
  };
}

describe('deriveTicket — market', () => {
  it('market buy: entry = Ask, value / margin / tick', () => {
    const v = deriveTicket(state(), ctx);
    expect(v.entry).toBe(201.57);
    expect(v.qty.units).toBe(100);
    expect(v.qty.tradeValue).toBeCloseTo(20_157, 6);
    expect(v.qty.margin).toBeCloseTo(403.14, 2);
    expect(v.qty.tickValue).toBeCloseTo(1, 6);
    expect(v.draft).toMatchObject({ symbol: 'AAPL', side: 'buy', type: 'market', qty: 100, tif: 'week' });
    expect(v.expiresAt).toBeNull();
  });

  it('market sell: entry = Bid', () => {
    expect(deriveTicket(state({ side: 'sell' }), ctx).entry).toBe(201.56);
  });

  it('SL 197.50 + TP 211.00 → −407 / +943, R:R 2.32 (Figma "Market • Filled")', () => {
    const v = deriveTicket(
      state({
        sl: { enabled: true, unit: 'price', input: '197.50', touched: true },
        tp: { enabled: true, unit: 'price', input: '211.00', touched: true },
      }),
      ctx,
    );
    expect(v.sl.level).toMatchObject({ price: 197.5, money: -407, ticks: 407 });
    expect(v.tp.level).toMatchObject({ price: 211, money: 943, ticks: 943 });
    expect(v.riskReward).toBeCloseTo(2.32, 2);
    expect(v.draft).toMatchObject({ stopLoss: 197.5, takeProfit: 211 });
  });

  it('risk sizing: Risk USD 400 with SL 197.50 → 98 shares, real risk 398.86', () => {
    const v = deriveTicket(state({ qtyUnit: 'riskMoney', qtyInput: '400', sl: { enabled: true, unit: 'price', input: '197.50', touched: true } }), ctx);
    expect(v.qty.units).toBe(98);
    expect(v.qty.realRisk).toBe(398.86);
    expect(v.qty.margin).toBeCloseTo(395.08, 2);
  });

  it('risk sizing without stop loss asks to set one', () => {
    const v = deriveTicket(state({ qtyUnit: 'riskMoney', qtyInput: '400' }), ctx);
    expect(v.disabledReason).toBe('set-stop-loss');
    expect(v.disabledText).toBe('Set stop loss to calculate size');
    expect(v.canSubmit).toBe(false);
  });

  it('% balance 20 → 99 shares', () => {
    expect(deriveTicket(state({ qtyUnit: 'balancePercent', qtyInput: '20' }), ctx).qty.units).toBe(99);
  });

  it('empty quantity disables submit with the reason', () => {
    const v = deriveTicket(state({ qtyInput: '' }), ctx);
    expect(v.disabledReason).toBe('enter-quantity');
    expect(v.disabledText).toBe('Enter quantity to buy AAPL');
  });
});

describe('deriveTicket — limit / stop', () => {
  it('limit 199.00 → Ask − 257 ticks, week expiry', () => {
    const v = deriveTicket(state({ type: 'limit', priceInput: '199.00' }), ctx);
    expect(v.price).toMatchObject({ value: 199, offsetTicks: -257, ref: 'Ask', fillsNow: false, invalid: false });
    expect(v.entry).toBe(199);
    expect(v.draft).toMatchObject({ type: 'limit', limitPrice: 199 });
    expect(v.expiresAt).toBe(new Date(2026, 9, 15, 23, 59, 59, 999).getTime());
  });

  it('buy limit above Ask is flagged as fills now but still submittable (production)', () => {
    const v = deriveTicket(state({ type: 'limit', priceInput: '201.64' }), ctx);
    expect(v.price).toMatchObject({ offsetTicks: 7, fillsNow: true });
    expect(v.canSubmit).toBe(true);
  });

  it('sell stop above Bid is invalid ("Selected price isn\'t valid…")', () => {
    const v = deriveTicket(state({ side: 'sell', type: 'stop', priceInput: '201.70' }), ctx);
    expect(v.price?.invalid).toBe(true);
    expect(v.disabledText).toBe("Selected price isn't valid for this order type");
  });

  it('limit with exits uses the limit price as entry (Figma "Limit • Filled")', () => {
    const v = deriveTicket(
      state({
        type: 'limit',
        priceInput: '199.00',
        sl: { enabled: true, unit: 'price', input: '195.00', touched: true },
        tp: { enabled: true, unit: 'price', input: '207.00', touched: true },
      }),
      ctx,
    );
    expect(v.sl.level?.money).toBe(-400);
    expect(v.tp.level?.money).toBe(800);
    expect(v.riskReward).toBeCloseTo(2, 6);
    expect(v.qty.margin).toBeCloseTo(398, 2);
  });

  it('untouched take profit follows entry at +75 ticks; SL 25 ticks default', () => {
    const v = deriveTicket(
      state({
        type: 'limit',
        priceInput: '378.85',
        tp: { enabled: true, unit: 'price', input: '', touched: false },
        sl: { enabled: true, unit: 'ticks', input: '25', touched: true },
      }),
      {
        ...ctx,
        quote: { ...quote, bid: 378.67, ask: 378.85 },
      },
    );
    expect(v.tp.input).toBe('379.60');
    expect(v.sl.level?.price).toBe(378.6);
  });

  it('wrong-side exit blocks submit with a message', () => {
    const v = deriveTicket(state({ sl: { enabled: true, unit: 'price', input: '205', touched: true } }), ctx);
    expect(v.disabledReason).toBe('invalid-exit');
    expect(v.disabledText).toBe('Stop loss must be below entry price');
  });

  it('GTD uses the chosen date', () => {
    const v = deriveTicket(state({ type: 'limit', priceInput: '199', tif: 'gtd', gtdDate: '2026-10-20' }), ctx);
    expect(v.draft?.expiresAt).toBe(new Date(2026, 9, 20, 23, 59, 59, 999).getTime());
  });

  it('no quote → not ready', () => {
    expect(deriveTicket(state(), { ...ctx, quote: undefined }).disabledReason).toBe('no-quote');
  });
});
