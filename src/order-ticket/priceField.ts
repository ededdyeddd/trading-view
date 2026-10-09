/**
 * Redesign: validation rules of the limit / stop price field, as pure patches of the ticket state.
 * The store applies them on commit, side / type / symbol changes and submit.
 *
 * - An empty price shows a grey placeholder (Limit 1%, Stop 1.5% from the market, on a round step); it follows the market
 *   (deriveTicket) and fills in only on a click. Nothing here changes the typed price by itself.
 * - "Fills now" / "Triggers now" is evaluated only on commit (blur, step, 600 ms after typing), side / type / symbol
 *   change and submit — never on a tick. Between evaluations the last status stays.
 */
import type { SymbolSpec } from '../config/symbols';
import { priceStatus, type PriceStatus } from '../lib/orderMath';
import type { Quote } from '../market/types';
import { priceValue } from './deriveTicket';
import type { TicketState } from './types';

/** Debounce of a typed price before it is validated. */
export const PRICE_COMMIT_MS = 600;

/** Status of the current price at this quote ('ok' for market, an empty field or no quote). */
export function evaluatePriceStatus(state: TicketState, quote: Quote | undefined, spec: SymbolSpec): PriceStatus {
  if (state.type === 'market' || !quote) return 'ok';
  const value = priceValue(state, quote, spec);
  return value === null ? 'ok' : priceStatus(state.type, state.side, value, quote.bid, quote.ask);
}

/** After a side or type change (`state` already has the new one): the typed price stays, its status is re-evaluated. */
export function statusPatch(state: TicketState, quote: Quote | undefined, spec: SymbolSpec): Pick<TicketState, 'priceStatus'> {
  return { priceStatus: evaluatePriceStatus(state, quote, spec) };
}

/**
 * Submit click: re-validate at the current quote. A price that just turned bad (status was 'ok') is not sent — the warning
 * shows and the next click sends. A warning the user already saw does not block.
 */
export function submitCheck(state: TicketState, quote: Quote | undefined, spec: SymbolSpec): { send: boolean; priceStatus: PriceStatus } {
  const next = evaluatePriceStatus(state, quote, spec);
  return { send: !(next !== 'ok' && state.priceStatus === 'ok'), priceStatus: next };
}
