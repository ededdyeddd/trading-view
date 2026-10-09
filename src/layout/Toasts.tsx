import { Ban, CheckCircle2, CircleAlert, Clock3, Info, X } from 'lucide-react';
import { useTradingStore } from '../store/tradingStore';
import styles from './Toasts.module.css';

const ICONS = {
  placed: { icon: Info, cls: styles.info, title: 'Order placed' },
  modified: { icon: Info, cls: styles.info, title: 'Order modified' },
  filled: { icon: CheckCircle2, cls: styles.success, title: 'Order executed' },
  positionClosed: { icon: CheckCircle2, cls: styles.success, title: 'Position closed' },
  cancelled: { icon: Ban, cls: styles.muted, title: 'Order cancelled' },
  expired: { icon: Clock3, cls: styles.warn, title: 'Order expired' },
  rejected: { icon: CircleAlert, cls: styles.error, title: 'Order rejected' },
} as const;

/** Paper Trading notifications after submit, fill, cancel, expiry and rejection. */
export function Toasts() {
  const toasts = useTradingStore((s) => s.toasts);
  const dismiss = useTradingStore((s) => s.dismissToast);
  return (
    <div className={styles.stack} aria-live="polite">
      {toasts.map((t) => {
        const meta = ICONS[t.type];
        const Icon = meta.icon;
        const text = t.message.includes(': ') ? t.message.slice(t.message.indexOf(': ') + 2) : t.message;
        return (
          <div key={t.id} className={styles.toast} role="status" data-testid={`toast-${t.type}`}>
            <Icon size={20} className={meta.cls} strokeWidth={1.8} />
            <div className={styles.text}>
              <div className={styles.title}>{meta.title}</div>
              <div className={styles.message}>{text}</div>
            </div>
            <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
