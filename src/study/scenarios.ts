/**
 * Usability-test scenarios (PRD, Appendix C, block 9) and the automatic check of the submitted OrderDraft.
 * Pure: no store, no DOM.
 */
import type { OrderDraft, TimeInForce } from '../engine/types';
import type { OrderType, Side } from '../lib/orderMath';

export type ScenarioId = 1 | 2 | 3;

export type Market = { bid: number; ask: number };

type Expectation = {
  side: Side;
  type: OrderType;
  /** Expected quantity (±1 unit) — omitted = any positive quantity. */
  qty?: number;
  /** Expected limit/stop price, possibly relative to the market at submit time. */
  price?: (m: Market) => number;
  priceTolerance?: number;
  stopLoss?: number;
  takeProfit?: number;
  tif?: TimeInForce;
};

export type Scenario = {
  id: ScenarioId;
  title: string;
  /** Task text shown in the strip above the interface. */
  task: string;
  /** Simulator seed: the same scenario always gets the same market. */
  seed: number;
  expect: Expectation;
};

export const SCENARIOS: Scenario[] = [
  {
    id: 1,
    title: 'Market with SL and TP',
    task: 'Buy 100 AAPL at market with a stop loss at 197.50 and a take profit at 211.00.',
    seed: 1001,
    expect: { side: 'buy', type: 'market', qty: 100, stopLoss: 197.5, takeProfit: 211 },
  },
  {
    id: 2,
    title: 'Limit sized by risk',
    task: 'Buy AAPL with a limit order at 199.00, risking 400 USD, stop loss 195.00, take profit 207.00.',
    seed: 1002,
    expect: { side: 'buy', type: 'limit', qty: 100, price: () => 199, priceTolerance: 0.001, stopLoss: 195, takeProfit: 207 },
  },
  {
    id: 3,
    title: 'Sell limit for a week',
    task: 'Sell AAPL with a limit order 1 USD above the market, valid for a week.',
    seed: 1003,
    expect: { side: 'sell', type: 'limit', price: (m) => m.bid + 1, priceTolerance: 0.25, tif: 'week' },
  },
];

export function getScenario(id: number): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export type CheckResult = { pass: boolean; mismatches: string[] };

const near = (a: number | undefined, b: number, tol = 0.005) => a !== undefined && Math.abs(a - b) <= tol;

/** Compares a submitted draft with the scenario: side, type, price, quantity (±1), SL, TP, time in force. */
export function checkDraft(draft: OrderDraft | null | undefined, scenario: Scenario, market: Market): CheckResult {
  if (!draft) return { pass: false, mismatches: ['no order submitted'] };
  const e = scenario.expect;
  const m: string[] = [];
  if (draft.side !== e.side) m.push(`side: ${draft.side} ≠ ${e.side}`);
  if (draft.type !== e.type) m.push(`type: ${draft.type} ≠ ${e.type}`);
  if (e.qty !== undefined ? Math.abs(draft.qty - e.qty) > 1 : !(draft.qty > 0)) m.push(`qty: ${draft.qty} ≠ ${e.qty ?? '>0'}`);
  if (e.price) {
    const want = e.price(market);
    const got = draft.type === 'stop' ? draft.stopPrice : draft.limitPrice;
    if (!near(got, want, e.priceTolerance ?? 0.005)) m.push(`price: ${got ?? '—'} ≠ ${want.toFixed(2)}`);
  }
  if (e.stopLoss !== undefined && !near(draft.stopLoss, e.stopLoss)) m.push(`SL: ${draft.stopLoss ?? '—'} ≠ ${e.stopLoss}`);
  if (e.takeProfit !== undefined) {
    const tp = draft.takeProfit ?? draft.takeProfits?.[0]?.price;
    if (!near(tp, e.takeProfit)) m.push(`TP: ${tp ?? '—'} ≠ ${e.takeProfit}`);
  }
  if (e.tif !== undefined && draft.tif !== e.tif) m.push(`TIF: ${draft.tif} ≠ ${e.tif}`);
  return { pass: m.length === 0, mismatches: m };
}
