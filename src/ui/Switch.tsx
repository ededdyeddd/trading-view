import styles from './Switch.module.css';

export function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.track} ${checked ? styles.on : ''}`}
      onClick={() => onChange(!checked)}
      data-testid={testId}
    >
      <span className={styles.thumb} />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`${styles.checkbox} ${disabled ? styles.disabled : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.box} aria-hidden>
        {checked && (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </label>
  );
}
