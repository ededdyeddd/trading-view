import { getVariant } from '../store/variantStore';

export type TicketEventType =
  | 'ticket_open'
  | 'ticket_close'
  | 'side_change'
  | 'type_change'
  | 'unit_change'
  | 'field_change'
  | 'toggle_change'
  | 'submit'
  | 'submit_result'
  | 'validation_error'
  | 'order_cancel'
  | 'order_modify'
  | 'position_close'
  | 'symbol_change'
  | 'panel_switch';

export type LoggedEvent = {
  /** ms since epoch */
  t: number;
  type: TicketEventType;
  panel: string;
  /** Ticket session id: increments on every ticket_open. */
  session: number;
  data?: Record<string, unknown>;
};

const events: LoggedEvent[] = [];
let session = 0;
let openedAt: number | null = null;
const listeners = new Set<() => void>();

/** Debounce key → timer: field edits are logged once the user pauses typing. */
const pendingFields = new Map<string, { timer: ReturnType<typeof setTimeout>; flush: () => void }>();

export function logEvent(type: TicketEventType, data?: Record<string, unknown>) {
  if (type === 'ticket_open') {
    session += 1;
    openedAt = Date.now();
  }
  if (type === 'submit' && openedAt !== null) data = { ...data, msFromOpen: Date.now() - openedAt };
  if (type === 'submit' || type === 'ticket_close') flushFields();
  events.push({ t: Date.now(), type, panel: getVariant(), session, data });
  listeners.forEach((l) => l());
}

/** Logs a field edit after 700 ms without further changes to the same field. */
export function logFieldChange(field: string, value: unknown) {
  const prev = pendingFields.get(field);
  if (prev) clearTimeout(prev.timer);
  const flush = () => {
    pendingFields.delete(field);
    logEvent('field_change', { field, value });
  };
  pendingFields.set(field, { timer: setTimeout(flush, 700), flush });
}

function flushFields() {
  const list = [...pendingFields.values()];
  list.forEach((p) => {
    clearTimeout(p.timer);
    p.flush();
  });
}

export function getEvents(): LoggedEvent[] {
  return events.slice();
}

export function clearEvents() {
  events.length = 0;
  listeners.forEach((l) => l());
}

export function onEventsChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function exportEventsJson(): string {
  flushFields();
  return JSON.stringify({ exportedAt: new Date().toISOString(), panel: getVariant(), userAgent: navigator.userAgent, events }, null, 2);
}
