import { PANEL_VARIANT } from '../config/flags';
import { useOrderTicket } from '../order-ticket/ticketStore';
import { CurrentOrderPanel } from './current/CurrentOrderPanel';
import { NewOrderPanel } from './new/NewOrderPanel';

/**
 * Picks the order panel variant (?panel=current|new). Both receive the same ticket contract
 * (raw state + derived view + spec/quote/account) and submit the same OrderDraft.
 */
export function OrderPanelHost() {
  const ticket = useOrderTicket();
  return PANEL_VARIANT === 'new' ? <NewOrderPanel ticket={ticket} /> : <CurrentOrderPanel ticket={ticket} />;
}
