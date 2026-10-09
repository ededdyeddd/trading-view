import { useVariantStore } from '../store/variantStore';
import styles from './PanelSwitch.module.css';

const OPTIONS = [
  { id: 'current', label: 'Current' },
  { id: 'new', label: 'New' },
] as const;

/** Floating switch (bottom-left) between the production order panel and the redesign. */
export function PanelSwitch() {
  const variant = useVariantStore((s) => s.variant);
  const setVariant = useVariantStore((s) => s.setVariant);
  return (
    <div className={styles.switch} role="radiogroup" aria-label="Order panel version" data-testid="panel-switch">
      <span className={styles.label}>Order panel</span>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={variant === o.id}
          className={`${styles.option} ${variant === o.id ? styles.active : ''}`}
          onClick={() => setVariant(o.id)}
          data-testid={`panel-switch-${o.id}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
