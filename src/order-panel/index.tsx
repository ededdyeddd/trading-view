import { useVariantStore } from '../store/variantStore';
import { useOrderTicket } from '../order-ticket/ticketStore';
import { CurrentOrderPanel } from './current/CurrentOrderPanel';
import { NewOrderPanel } from './new/NewOrderPanel';

/**
 * Picks the order panel variant (floating switch / ?panel=current|new). Both receive the same ticket contract
 * (raw state + derived view + spec/quote/account) and submit the same OrderDraft.
 */
export function OrderPanelHost() {
  const ticket = useOrderTicket();
  const variant = useVariantStore((s) => s.variant);
  return variant === 'new' ? <NewOrderPanel ticket={ticket} /> : <CurrentOrderPanel ticket={ticket} />;
}
