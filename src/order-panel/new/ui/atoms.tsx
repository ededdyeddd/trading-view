import { ChevronDown, ChevronRight, ChevronUp, Clock3, LoaderCircle, Plus, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Side } from '../../../lib/orderMath';
import { MenuItem, Popover } from '../../../ui/Popover';
import type { CaptionTone, Tone } from '../presenters';
import s from './ui.module.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------

export function SegmentedControl<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={s.segmented} role="tablist">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          role="tab"
          aria-selected={i.id === value}
          className={cx(s.segment, i.id === value && s.segmentActive)}
          onClick={() => onChange(i.id)}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

type SideToggleProps = { side: Side; bid: string; ask: string; spread: string; onChange: (side: Side) => void };

/** Sell (Bid) / Buy (Ask) with the spread between them. */
export function SideToggle({ side, bid, ask, spread, onChange }: SideToggleProps) {
  return (
    <div className={s.side}>
      <button
        type="button"
        className={cx(s.sideBtn, s.sideSell, side === 'sell' && s.sideActive)}
        aria-pressed={side === 'sell'}
        onClick={() => onChange('sell')}
        data-testid="nt-side-sell"
      >
        <span className={s.sideTitle}>Sell</span>
        <span className={cx(s.sideValue, 'tabular')}>{bid}</span>
      </button>
      <button
        type="button"
        className={cx(s.sideBtn, s.sideBuy, side === 'buy' && s.sideActive)}
        aria-pressed={side === 'buy'}
        onClick={() => onChange('buy')}
        data-testid="nt-side-buy"
      >
        <span className={s.sideTitle}>Buy</span>
        <span className={cx(s.sideValue, 'tabular')}>{ask}</span>
      </button>
      <span className={cx(s.spread, 'tabular')} aria-label="Spread">
        {spread}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function UnderlineTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className={s.tabs} role="tablist">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          role="tab"
          aria-selected={i.id === value}
          className={cx(s.tab, i.id === value && s.tabActive)}
          onClick={() => onChange(i.id)}
          title={i.disabled ? 'Coming soon' : undefined}
          data-testid={`nt-type-${i.id}`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export type MenuOption<T extends string> = { value: T; label: string; end?: string; disabled?: boolean };

/** Field label that is also the unit dropdown: "Shares ▾", "Stop loss price ▾"; the menu shows live values per unit. */
export function FieldLabelMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  forceOpen,
  testId,
}: {
  label: string;
  value: T;
  options: MenuOption<T>[];
  onChange: (v: T) => void;
  /** Sandbox only. */
  forceOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const isOpen = open || !!forceOpen;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cx(s.labelMenu, isOpen && s.labelMenuOpen)}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-testid={testId}
      >
        {label}
        {isOpen ? <ChevronUp size={18} strokeWidth={1.5} /> : <ChevronDown size={18} strokeWidth={1.5} />}
      </button>
      <Popover anchor={ref} open={isOpen} onClose={() => setOpen(false)}>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            active={o.value === value}
            disabled={o.disabled}
            end={o.disabled ? 'Soon' : o.end}
            onSelect={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            {o.label}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------

export type FieldState = 'default' | 'error' | 'warning';

type ValueFieldProps = {
  /** Raw text while editing. */
  value: string;
  /** Text shown when the field is not focused (formatted with grouping). */
  display?: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** "0"-style placeholder is the bold text at 50%; text placeholders ("Enter price") are secondary. */
  placeholderStyle?: 'value' | 'text';
  suffix?: string;
  right?: string;
  rightTone?: Tone;
  state?: FieldState;
  disabled?: boolean;
  /** ArrowUp / ArrowDown step and decimals. */
  step?: number;
  decimals?: number;
  onEnter?: () => void;
  onBlur?: () => void;
  ariaLabel: string;
  testId?: string;
  /** Sandbox only. */
  forceFocus?: boolean;
};

/** Value on the left (with unit suffix), a second value on the right, no swap button. */
export function ValueField({
  value,
  display,
  onChange,
  placeholder,
  placeholderStyle = 'value',
  suffix,
  right,
  rightTone = 'neutral',
  state = 'default',
  disabled,
  step = 1,
  decimals = 0,
  onEnter,
  onBlur,
  ariaLabel,
  testId,
  forceFocus,
}: ValueFieldProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = focused ? value : (display ?? value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const n = Number(value.replace(/,/g, '')) || 0;
    onChange(Math.max(0, n + (e.key === 'ArrowUp' ? step : -step)).toFixed(decimals));
  };
  const isFocus = (focused || forceFocus) && !disabled;
  return (
    <div
      className={cx(
        s.field,
        isFocus && state === 'default' && s.fieldFocus,
        state === 'error' && !disabled && s.fieldError,
        state === 'warning' && !disabled && s.fieldWarning,
        disabled && s.fieldDisabled,
        placeholderStyle === 'text' && s.placeholderText,
      )}
      onMouseDown={(e) => {
        if (disabled || e.target === inputRef.current) return;
        e.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <span className={s.valueLeft}>
        <span className={s.grow} data-value={shown || placeholder}>
          <input
            ref={inputRef}
            className={s.input}
            size={1}
            value={shown}
            placeholder={placeholder}
            disabled={disabled}
            inputMode="decimal"
            aria-label={ariaLabel}
            aria-invalid={state === 'error' || undefined}
            onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              onBlur?.();
            }}
            onKeyDown={onKeyDown}
            data-testid={testId}
          />
        </span>
        {suffix && shown !== '' && <span className={s.suffix}>{suffix}</span>}
      </span>
      {right && (
        <span
          className={cx(
            s.valueRight,
            rightTone === 'danger' && s.toneDanger,
            rightTone === 'success' && s.toneSuccess,
            rightTone === 'warning' && s.toneWarning,
          )}
        >
          {right}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FieldCaption({
  tone = 'neutral',
  children,
  testId,
  onAction,
}: {
  tone?: CaptionTone;
  children: ReactNode;
  testId?: string;
  onAction?: () => void;
}) {
  return (
    <div
      className={cx(s.caption, tone === 'error' && s.captionError, tone === 'warning' && s.captionWarning)}
      role={tone === 'error' ? 'alert' : undefined}
      data-testid={testId}
    >
      {onAction ? (
        <button type="button" className={s.captionLink} onClick={onAction} data-testid={testId ? `${testId}-action` : undefined}>
          {children}
        </button>
      ) : (
        children
      )}
    </div>
  );
}

export function IconButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className={s.iconButton} aria-label={label} title={label} onClick={onClick} data-testid={testId}>
      <X size={14} strokeWidth={1.8} />
    </button>
  );
}

/** New atom: a notice above the form (e.g. "Market is closed · opens Mon 15:30"). No 2a atom is a page-level banner. */
export function Banner({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={s.banner} role="status" data-testid={testId}>
      <Clock3 size={16} className={s.bannerIcon} />
      <span>{children}</span>
    </div>
  );
}

/**
 * New atom: GTD date + time. ValueField is a numeric value/suffix/right-value control and cannot host
 * native date and time pickers with a min date.
 */
export function DateTimeField({
  date,
  time,
  minDate,
  onChange,
}: {
  date: string;
  time: string;
  minDate: string;
  onChange: (date: string, time: string) => void;
}) {
  return (
    <div className={s.dateTime}>
      <input
        type="date"
        className={s.dateInput}
        value={date}
        min={minDate}
        onChange={(e) => onChange(e.target.value, time)}
        aria-label="Good till date"
        data-testid="nt-gtd-date"
      />
      <input
        type="time"
        className={cx(s.dateInput, s.timeInput)}
        value={time}
        onChange={(e) => onChange(date, e.target.value)}
        aria-label="Good till time"
        data-testid="nt-gtd-time"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx(s.switch, checked && s.switchOn)}
      onClick={() => onChange(!checked)}
      data-testid={testId}
    />
  );
}

// ---------------------------------------------------------------------------

type ExitLevelProps<T extends string> = {
  label: string;
  /** Extra field to the right of the value field (TP "% of position"). */
  aside?: ReactNode;
  unit: T;
  units: MenuOption<T>[];
  onUnit: (u: T) => void;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  title: string;
  field: Omit<ValueFieldProps, 'disabled'>;
  caption: string | null;
  captionTone: CaptionTone;
  testId: string;
};

/** Label menu + switch + ValueField + caption. Off = grey field with a placeholder. */
export function ExitLevel<T extends string>({
  label,
  unit,
  units,
  onUnit,
  enabled,
  onToggle,
  title,
  field,
  caption,
  captionTone,
  testId,
  aside,
}: ExitLevelProps<T>) {
  return (
    <div data-testid={testId}>
      <div className={s.exitHeader}>
        <FieldLabelMenu label={label} value={unit} options={units} onChange={onUnit} testId={`${testId}-unit`} />
        <Switch checked={enabled} onChange={onToggle} label={title} testId={`${testId}-toggle`} />
      </div>
      {aside ? (
        <div className={s.dateTime}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ValueField {...field} disabled={!enabled} placeholderStyle="text" />
          </div>
          {aside}
        </div>
      ) : (
        <ValueField {...field} disabled={!enabled} placeholderStyle="text" />
      )}
      {enabled && caption && (
        <FieldCaption tone={captionTone} testId={`${testId}-caption`}>
          {caption}
        </FieldCaption>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.infoRow}>
      <span className={s.infoLabel}>{label}</span>
      <span className={s.infoValue}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

type SettingsRowProps = {
  title: string;
  value?: string;
  /** right = navigates (Time in force), down/up = collapsible section. */
  chevron: 'right' | 'down' | 'up';
  onClick?: () => void;
  testId?: string;
};

export function SettingsRow({ title, value, chevron, onClick, testId }: SettingsRowProps) {
  const Icon = chevron === 'right' ? ChevronRight : chevron === 'down' ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      className={s.settingsRow}
      onClick={onClick}
      disabled={!onClick}
      aria-expanded={chevron === 'right' ? undefined : chevron === 'up'}
      data-testid={testId}
    >
      <span className={s.settingsTitle}>{title}</span>
      {value && <span className={s.settingsValue}>{value}</span>}
      <Icon size={18} strokeWidth={1.5} />
    </button>
  );
}

// ---------------------------------------------------------------------------

/** "+ Add level" text button; with `tooltip` and no handler it shows the tooltip instead ("Coming soon"). */
export function TextButton({ children, tooltip, onClick }: { children: ReactNode; tooltip?: string; onClick?: () => void }) {
  const [tip, setTip] = useState(false);
  return (
    <button
      type="button"
      className={s.textButton}
      onClick={() => {
        if (onClick) return onClick();
        setTip(true);
        setTimeout(() => setTip(false), 1500);
      }}
      onMouseEnter={() => tooltip && setTip(true)}
      onMouseLeave={() => setTip(false)}
      data-testid="nt-add-level"
    >
      <Plus size={18} strokeWidth={1.5} />
      {children}
      {tip && tooltip && <span className={s.tooltip}>{tooltip}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------

type SubmitButtonProps = {
  side: Side;
  primary: string;
  secondary: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
};

export function SubmitButton({ side, primary, secondary, disabled, loading, onClick }: SubmitButtonProps) {
  return (
    <button
      type="button"
      className={cx(s.submit, side === 'sell' && s.submitSell, loading && s.submitLoading)}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
      onClick={() => !loading && onClick()}
      data-testid="nt-submit"
    >
      <span className={s.submitPrimary}>
        {loading && <LoaderCircle size={16} className={s.spin} />}
        {primary}
      </span>
      <span className={s.submitSecondary}>{secondary}</span>
    </button>
  );
}

/** Pinned footer: optional summary ("SL −407.00 USD · TP +943.00 USD") wrapping the submit button. */
export function OrderSummary({ text, children }: { text: string | null; children: ReactNode }) {
  if (!text) return <>{children}</>;
  return (
    <div className={s.footerBlock}>
      <div className={s.summary} data-testid="nt-summary">
        {text}
      </div>
      {children}
    </div>
  );
}
