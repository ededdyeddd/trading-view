import { ArrowLeftRight, ChevronDown, ChevronUp } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MenuItem, Popover } from '../../ui/Popover';
import styles from './CurrentOrderPanel.module.css';

export type Option<T extends string> = { value: T; label: ReactNode; end?: ReactNode; disabled?: boolean };

/** Text-button dropdown like "Shares ▾" / "Take profit price ▾". */
export function LabelDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: ReactNode;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className={styles.labelDropdown} onClick={() => setOpen((v) => !v)} data-testid={testId}>
        {label}
        {open ? <ChevronUp size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)}>
        {options.map((o) => (
          <MenuItem key={o.value} active={o.value === value} disabled={o.disabled} end={o.end} onSelect={() => (onChange(o.value), setOpen(false))}>
            {o.label}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

/** Value + unit dropdown in the right slot of a field ("214.12 USD ▾", "75 ticks ▾"). */
export function SlotDropdown<T extends string>({
  value,
  unit,
  options,
  onChange,
  disabled,
  current,
}: {
  value: ReactNode;
  unit: ReactNode;
  options: Option<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  current: T;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className={styles.slotDropdown} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <span className="tabular">{value}</span>
        <span className={styles.slotUnit}>{unit}</span>
        <ChevronDown size={16} strokeWidth={1.5} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end">
        {options.map((o) => (
          <MenuItem key={o.value} active={o.value === current} disabled={o.disabled} end={o.end} onSelect={() => (onChange(o.value), setOpen(false))}>
            {o.label}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

type FieldProps = {
  value: string;
  onChange: (v: string) => void;
  /** ArrowUp/ArrowDown step. */
  step: number;
  decimals: number;
  disabled?: boolean;
  invalid?: boolean;
  /** Tooltip shown above the field while focused/hovered when invalid. */
  error?: string | null;
  right?: ReactNode;
  testId?: string;
  ariaLabel: string;
};

/**
 * Production-style numeric field: input · ⇆ · right slot. The ⇆ swap button is decorative in this
 * prototype (the redesign replaces these fields), so it does nothing.
 */
export function NumberField({ value, onChange, step, decimals, disabled, invalid, error, right, testId, ariaLabel }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState(false);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const n = Number(value.replace(/,/g, '')) || 0;
    const next = Math.max(0, n + (e.key === 'ArrowUp' ? step : -step));
    onChange(next.toFixed(decimals));
  };
  return (
    <div className={styles.fieldWrap} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {invalid && error && (focused || hover) && <div className={styles.fieldTooltip}>{error}</div>}
      <div className={`${styles.field} ${focused ? styles.fieldFocus : ''} ${invalid ? styles.fieldInvalid : ''} ${disabled ? styles.fieldDisabled : ''}`}>
        <input
          className={`${styles.input} tabular`}
          value={value}
          disabled={disabled}
          inputMode="decimal"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          data-testid={testId}
        />
        <span className={styles.swap} aria-hidden>
          <ArrowLeftRight size={16} strokeWidth={1.5} />
        </span>
        <span className={styles.right}>{right}</span>
      </div>
    </div>
  );
}
