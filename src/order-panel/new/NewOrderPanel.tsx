import type { OrderTicket } from '../../order-ticket/ticketStore';
import { useUiStore } from '../../store/uiStore';

/** Placeholder for the redesigned ticket (step 2, Figma e0zJvrcoBdJiypZDxVhY4O / 4102:77640). */
export function NewOrderPanel({ ticket }: { ticket: OrderTicket }) {
  const close = useUiStore((s) => s.closeTicket);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }} data-testid="order-panel" data-variant="new">
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
        {ticket.spec.symbol}
        <button type="button" onClick={close} aria-label="Close order panel">
          ✕
        </button>
      </div>
      <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
        The redesigned order panel will be implemented in step 2. Use <code>?panel=current</code> for the control version.
      </div>
    </div>
  );
}
