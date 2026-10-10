import { ArrowLeftRight, Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Info, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { parseNum } from '../../../lib/format';
import type { Side } from '../../../lib/orderMath';
import { MenuItem, Popover } from '../../../ui/Popover';
import type { CaptionTone, SummaryPart, Tone } from '../presenters';
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

export type MenuOption<T extends string> = {
  value: T;
  label: string;
  /** Live value of the order in this unit, on the right. */
  end?: string;
  /** Formula behind the value, shown on hover of an ⓘ next to the label. */
  info?: string;
  disabled?: boolean;
  /** Why a disabled item cannot be picked (hover tooltip). */
  disabledReason?: string;
};

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
            end={o.end}
            title={o.disabled ? o.disabledReason : undefined}
            onSelect={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            {o.label}
            {o.info && (
              <span className={s.menuInfo} aria-label={o.info} data-testid={testId ? `${testId}-info-${o.value}` : undefined}>
                <Info size={14} strokeWidth={1.5} />
                <span className={s.menuInfoTip} role="tooltip">
                  {o.info}
                </span>
              </span>
            )}
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
  /** Live suggested value: a click into the empty field substitutes it, selected, so typing replaces it. */
  fill?: string;
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
  /** The value is final: blur, or an ArrowUp / ArrowDown / wheel step. */
  onCommit?: () => void;
  ariaLabel: string;
  testId?: string;
  /** Sandbox only. */
  forceFocus?: boolean;
  /** Click on the disabled field turns it on (production SL/TP behavior); the field is focused once enabled. */
  onActivate?: () => void;
  /** ⇆ between the value and the right text: switches the input mode (tooltip = `label`). */
  swap?: { label: string; onClick: () => void; testId?: string };
  /** The value may be negative (an offset from Ask / Bid): "−" is accepted and steps may cross zero. */
  signed?: boolean;
  /** Focus the field when it appears, with its whole text selected (a level switched on by the user). */
  focusOnMount?: boolean;
};

const MINUS = '−';

/** Typed text: digits and one dot; with `signed` also a leading minus (a hyphen is turned into U+2212). */
function clean(raw: string, signed?: boolean): string {
  const neg = signed && /^\s*[-−]/.test(raw);
  const body = raw.replace(/[^\d.]/g, '');
  return neg ? `${MINUS}${body}` : body;
}

function offsetText(n: number, decimals: number): string {
  const t = Math.abs(n).toFixed(decimals);
  return n < 0 && Number(t) !== 0 ? `${MINUS}${t}` : t;
}

/** Value on the left (with unit suffix), a second value on the right, an optional ⇆ between them. */
export function ValueField({
  value,
  display,
  onChange,
  placeholder,
  fill,
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
  onCommit,
  ariaLabel,
  testId,
  forceFocus,
  onActivate,
  swap,
  signed,
  focusOnMount,
}: ValueFieldProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusOnEnable = useRef(false);
  const selectOnFocus = useRef(false);
  useEffect(() => {
    if (!disabled && focusOnEnable.current) {
      focusOnEnable.current = false;
      selectOnFocus.current = true;
      inputRef.current?.focus();
    }
  }, [disabled]);
  useLayoutEffect(() => {
    if (!focusOnMount) return;
    selectOnFocus.current = true;
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The level was switched on with its placeholder value: select it once the focused value is rendered.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!selectOnFocus.current || !focused || !el) return;
    selectOnFocus.current = false;
    el.select();
  }, [focused, value]);
  const shown = focused ? value : (display ?? value);
  /** One step up or down; an empty field starts from its suggested value (the grey placeholder). */
  const stepBy = (steps: number) => {
    const base = value !== '' ? value : (fill ?? '');
    const n = parseNum(base) || 0;
    const next = n + steps * step;
    onChange(signed ? offsetText(next, decimals) : Math.max(0, next).toFixed(decimals));
    onCommit?.();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    stepBy(e.key === 'ArrowUp' ? 1 : -1);
  };
  // Mouse wheel over the focused field steps the value (TradingView behavior) instead of scrolling the panel.
  // A native listener: React's onWheel is passive and cannot prevent the scroll.
  const fieldRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef(stepBy);
  useLayoutEffect(() => {
    stepRef.current = stepBy;
  });
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== inputRef.current || inputRef.current?.disabled) return;
      e.preventDefault();
      // Wheel up = step up. Small trackpad deltas accumulate to one step per ~40 px.
      acc += e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * 40;
      const steps = Math.trunc(acc / 40);
      if (steps === 0) return;
      acc -= steps * 40;
      stepRef.current(-steps);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const isFocus = (focused || forceFocus) && !disabled;
  return (
    <div
      ref={fieldRef}
      className={cx(
        s.field,
        isFocus && state === 'default' && s.fieldFocus,
        state === 'error' && !disabled && s.fieldError,
        state === 'warning' && !disabled && s.fieldWarning,
        disabled && s.fieldDisabled,
        disabled && onActivate && s.fieldActivatable,
        placeholderStyle === 'text' && s.placeholderText,
        swap && s.fieldSwap,
      )}
      onMouseDown={(e) => {
        if (disabled) {
          if (!onActivate) return;
          e.preventDefault();
          focusOnEnable.current = true;
          onActivate();
          return;
        }
        if (e.target === inputRef.current) return;
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
            onChange={(e) => onChange(clean(e.target.value, signed))}
            onFocus={(e) => {
              setFocused(true);
              if (value !== '' || !fill) return;
              // Substitute the suggested value right in the DOM (before React re-renders) and select it, so the
              // next keystroke replaces it; re-select after the click has placed the caret.
              const el = e.currentTarget;
              el.value = fill;
              el.select();
              onChange(fill);
              requestAnimationFrame(() => document.activeElement === el && el.value === fill && el.select());
            }}
            onBlur={() => {
              setFocused(false);
              onBlur?.();
              onCommit?.();
            }}
            onKeyDown={onKeyDown}
            data-testid={testId}
          />
        </span>
        {suffix && (shown !== '' || (placeholderStyle === 'value' && placeholder !== '')) && (
          <span className={cx(s.suffix, shown === '' && s.suffixPlaceholder)}>{suffix}</span>
        )}
      </span>
      {swap && (
        <button
          type="button"
          className={s.swap}
          aria-label={swap.label}
          title={swap.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={swap.onClick}
          data-testid={swap.testId}
        >
          <ArrowLeftRight size={18} strokeWidth={1.3} />
        </button>
      )}
      {right && (
        <span
          className={cx(
            s.valueRight,
            rightTone === 'danger' && s.toneDanger,
            rightTone === 'success' && s.toneSuccess,
            rightTone === 'warning' && s.toneWarning,
            rightTone === 'muted' && s.toneMuted,
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

/**
 * The reason above the button (FR-8.7). error = the order cannot be sent (assertive), warning = it can, with a caveat (polite).
 * The icon is always there: the kind never rests on colour alone. With `onClick` the whole plate is a button (error → its field).
 */
export function OrderInformer({ kind, children, onClick, testId = 'nt-informer' }: { kind: 'error' | 'warning'; children: ReactNode; onClick?: () => void; testId?: string }) {
  const body = (
    <>
      <span className={s.informerIcon} aria-hidden>
        !
      </span>
      <span className={s.informerText} data-testid={`${testId}-text`}>{children}</span>
    </>
  );
  return (
    <div
      className={cx(s.informer, kind === 'error' ? s.informerError : s.informerWarning)}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      data-kind={kind}
      data-testid={testId}
    >
      {onClick ? (
        <button type="button" className={s.informerButton} onClick={onClick}>
          {body}
        </button>
      ) : (
        body
      )}
    </div>
  );
}

/** Old atom: a notice above the form (e.g. "Market is closed · opens Mon 15:30"). Replaced by OrderInformer in the panel. */
export function Banner({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={s.banner} role="status" data-testid={testId}>
      <Clock3 size={16} className={s.bannerIcon} />
      <span>{children}</span>
    </div>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

/** A text input with an icon button on the right; the box takes the focus ring while typing or while its layer is open. */
function PickField({
  anchor,
  open,
  icon,
  iconLabel,
  onToggle,
  children,
}: {
  anchor: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  icon: ReactNode;
  iconLabel: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div ref={anchor} className={cx(s.pickField, open && s.pickFieldOpen)}>
      {children}
      <button type="button" className={s.pickIcon} aria-label={iconLabel} onMouseDown={(e) => e.preventDefault()} onClick={onToggle}>
        {icon}
      </button>
    </div>
  );
}

/** "2026-10-24" with a calendar: month arrows, Mo–Su, today underlined, the chosen day dark, days before `minDate` off. */
function DateField({ date, minDate, onChange }: { date: string; minDate: string; onChange: (date: string) => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const base = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : minDate;
  const [view, setView] = useState(() => ({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 }));
  const today = new Date();
  const todayKey = ymdOf(today.getFullYear(), today.getMonth(), today.getDate());
  // Monday-first grid of the viewed month.
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const step = (d: number) => setView((v) => ({ y: v.y + Math.floor((v.m + d) / 12), m: (((v.m + d) % 12) + 12) % 12 }));
  const commit = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= minDate && !Number.isNaN(Date.parse(value))) onChange(value);
  };
  return (
    <>
      <PickField
        anchor={anchor}
        open={open}
        icon={<Calendar size={18} strokeWidth={1.3} />}
        iconLabel="Open calendar"
        onToggle={() => setOpen((v) => !v)}
      >
        <input
          className={s.pickInput}
          value={draft ?? date}
          placeholder="YYYY-MM-DD"
          inputMode="numeric"
          aria-label="Good till date"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => e.key === 'Enter' && setOpen(false)}
          data-testid="nt-gtd-date"
        />
      </PickField>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
        <div className={s.calendar} data-testid="nt-calendar">
          <div className={s.calHead}>
            <button type="button" className={s.calNav} aria-label="Previous month" onClick={() => step(-1)}>
              <ChevronLeft size={18} strokeWidth={1.5} />
            </button>
            <span className={s.calTitle}>
              {MONTHS[view.m]} {view.y}
            </span>
            <button type="button" className={s.calNav} aria-label="Next month" onClick={() => step(1)}>
              <ChevronRight size={18} strokeWidth={1.5} />
            </button>
          </div>
          <div className={s.calGrid}>
            {WEEKDAYS.map((w) => (
              <span key={w} className={s.calWeekday}>
                {w}
              </span>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <span key={`e${i}`} />;
              const key = ymdOf(view.y, view.m, d);
              const off = key < minDate;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={off}
                  className={cx(s.calDay, key === date && s.calDaySelected, key === todayKey && s.calDayToday)}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  data-testid={`nt-cal-${key}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </Popover>
    </>
  );
}

/** Quarter-hour slots of a day plus the current value. */
function timeSlots(current: string): string[] {
  const slots = Array.from({ length: 96 }, (_, i) => `${pad2(Math.floor(i / 4))}:${pad2((i % 4) * 15)}`);
  return /^\d{2}:\d{2}$/.test(current) && !slots.includes(current) ? [...slots, current].sort() : slots;
}

/** "18:02" with a list of quarter-hour times (the chosen one dark); the text can be typed too. */
function TimeField({ time, onChange }: { time: string; onChange: (time: string) => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'start' });
  }, [open]);
  const commit = (value: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) onChange(`${pad2(Number(m[1]))}:${m[2]}`);
  };
  return (
    <>
      <PickField
        anchor={anchor}
        open={open}
        icon={<Clock3 size={18} strokeWidth={1.3} />}
        iconLabel="Open times"
        onToggle={() => setOpen((v) => !v)}
      >
        <input
          className={s.pickInput}
          value={draft ?? time}
          placeholder="HH:MM"
          inputMode="numeric"
          aria-label="Good till time"
          onFocus={(e) => {
            setOpen(true);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => e.key === 'Enter' && setOpen(false)}
          data-testid="nt-gtd-time"
        />
      </PickField>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} matchWidth align="end">
        <div className={s.timeList} role="listbox" data-testid="nt-time-list">
          {timeSlots(time).map((t) => (
            <button
              key={t}
              ref={t === time ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={t === time}
              className={cx(s.timeItem, t === time && s.timeItemActive)}
              onClick={() => {
                onChange(t);
                setOpen(false);
              }}
              data-testid={`nt-time-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/** GTD date + time: a calendar and a list of times in the style of the platform (minimum date: tomorrow). */
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
      <DateField date={date} minDate={minDate} onChange={(d) => onChange(d, time)} />
      <TimeField time={time} onChange={(tm) => onChange(date, tm)} />
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
  /** Switched off: the field is this action text ("Set at 197.54"); without it a grey disabled field is drawn. */
  offText?: string;
  /** aria-label of the switched-off field: "Stop loss off. Activate to set at 197.54". */
  offLabel?: string;
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

/** Label menu + switch + ValueField + caption. Off = grey field with a placeholder (numeric when the field passes `placeholderStyle: 'value'`). */
/** The field of a switched-off level: grey action text instead of a value. Click, Space or Enter turns the level on. */
function ActionField({ text, ariaLabel, onActivate, testId }: { text: string; ariaLabel: string; onActivate: () => void; testId?: string }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className={cx(s.field, s.fieldAction)}
      // mousedown would move the focus onto the field just before it is replaced by the input
      onMouseDown={(e) => e.preventDefault()}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        onActivate();
      }}
      data-testid={testId}
    >
      <span className={s.fieldActionText}>{text}</span>
    </div>
  );
}

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
  offText,
  offLabel,
}: ExitLevelProps<T>) {
  // A level the user turns on gets the focus in its field, text selected (the panel turning it on itself does not).
  const [focusNext, setFocusNext] = useState(false);
  if (!enabled && focusNext) setFocusNext(false);
  const turnOn = () => {
    setFocusNext(true);
    onToggle(true);
  };
  const input = <ValueField placeholderStyle="text" {...field} disabled={!enabled} focusOnMount={focusNext} onActivate={() => onToggle(true)} />;
  const action =
    offText !== undefined && !enabled ? (
      <ActionField text={offText} ariaLabel={offLabel ?? title} onActivate={turnOn} testId={field.testId} />
    ) : null;
  return (
    <div data-testid={testId}>
      <div className={s.exitHeader}>
        <FieldLabelMenu label={label} value={unit} options={units} onChange={onUnit} testId={`${testId}-unit`} />
        <Switch checked={enabled} onChange={(v) => (v ? turnOn() : onToggle(false))} label={title} testId={`${testId}-toggle`} />
      </div>
      {aside ? (
        <div className={s.dateTime}>
          <div style={{ flex: 1, minWidth: 0 }}>{action ?? input}</div>
          {aside}
        </div>
      ) : (
        (action ?? input)
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
  /** right = navigates (Expires), down/up = collapsible section. */
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

/** "+ Add partial exit" text button; with `tooltip` and no handler it shows the tooltip instead ("Coming soon"). */
export function TextButton({
  children,
  tooltip,
  onClick,
  disabled,
  disabledReason,
  testId = 'nt-add-level',
  plus = true,
}: {
  children: ReactNode;
  tooltip?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Hover text of a disabled button. */
  disabledReason?: string;
  testId?: string;
  plus?: boolean;
}) {
  const [tip, setTip] = useState(false);
  return (
    <button
      type="button"
      className={cx(s.textButton, disabled && s.textButtonDisabled)}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      onClick={() => {
        if (disabled) return;
        if (onClick) return onClick();
        setTip(true);
        setTimeout(() => setTip(false), 1500);
      }}
      onMouseEnter={() => tooltip && setTip(true)}
      onMouseLeave={() => setTip(false)}
      data-testid={testId}
    >
      {plus && <Plus size={18} strokeWidth={1.5} />}
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

/**
 * Pinned footer: optional summary ("SL −407.00 USD · TP up to +818.00 USD · 3 exits", coloured labels, orange warnings)
 * wrapping the submit button. One line; when it does not fit "N exits" goes first, then the line wraps (numbers and
 * warnings are never cut).
 */
export function OrderSummary({ parts, children }: { parts: SummaryPart[] | null; children: ReactNode }) {
  const lineRef = useRef<HTMLDivElement>(null);
  const [hideExits, setHideExits] = useState(false);
  const key = parts?.map((p) => `${p.label}${p.prefix}${p.amount}`).join('|') ?? '';
  // Measure with every segment shown; if the line overflows drop the exits segment.
  useLayoutEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    const measure = () => {
      const probe = el.querySelector<HTMLElement>('[data-full-line]');
      if (probe) setHideExits(probe.scrollWidth > el.clientWidth + 0.5);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key]);
  if (!parts || parts.length === 0) return <>{children}</>;
  const shown = hideExits ? parts.filter((p) => p.kind !== 'exits') : parts;
  const line = (list: SummaryPart[]) =>
    list.map((p, i) => (
      <span key={`${p.kind}${i}`} className={s.summarySeg}>
        {i > 0 && <span className={s.summarySep}> · </span>}
        {p.label ? (
          <>
            <span className={p.label === 'SL' ? s.summaryLabelSl : s.summaryLabelTp}>{p.label}</span>
            <span className={s.summaryAmount}>{p.prefix ? ` ${p.prefix}` : ''} {p.amount}</span>
          </>
        ) : (
          <span className={p.kind === 'warning' ? s.summaryWarning : s.summaryAmount}>{p.amount}</span>
        )}
      </span>
    ));
  return (
    <div className={s.footerBlock}>
      <div ref={lineRef} className={s.summary}>
        {/* invisible single-line probe of the full text */}
        <span className={s.summaryProbe} data-full-line aria-hidden>
          {line(parts)}
        </span>
        <span data-testid="nt-summary">{line(shown)}</span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** "Protected size · 100%" with a bar (green at 100%, orange below). */
export function ExitProgress({ label, percent, percentText }: { label: string; percent: number; percentText: string }) {
  const full = percent >= 99.995;
  return (
    <div className={s.progress} data-testid="nt-protected">
      <div className={s.progressLegend}>
        <span>{label}</span>
        <span className={s.progressDot}>·</span>
        <span data-testid="nt-protected-value">{percentText}</span>
      </div>
      <div className={s.progressTrack} role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)}>
        <div className={cx(s.progressBar, !full && s.progressBarPartial)} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

export type LevelPart = { label: 'TP' | 'SL'; text: string; tone: 'normal' | 'off' | 'error' };

/** "Exit 2 · 25 shares · 25%" over a pill "TP 25 @ 211.00 · SL 25 @ 197.50" with a trash button; the pill opens the level editor. */
export function LevelRow({
  title,
  parts,
  onOpen,
  onRemove,
  testId,
}: {
  title: string;
  parts: LevelPart[];
  onOpen: () => void;
  onRemove: () => void;
  testId: string;
}) {
  return (
    <div className={s.levelRow} data-testid={testId}>
      <div className={s.levelTitle} data-testid={`${testId}-title`}>
        {title}
      </div>
      <div className={s.levelPill}>
        <button type="button" className={s.levelBody} onClick={onOpen} data-testid={`${testId}-open`}>
          {parts.map((p, i) => (
            <span key={p.label} className={p.tone === 'error' ? s.levelError : undefined}>
              {i > 0 && <span className={s.levelDot}> · </span>}
              <span className={p.tone === 'error' ? undefined : p.label === 'TP' ? s.levelTp : s.levelSl}>{p.label}</span>{' '}
              <span className={p.tone === 'off' && p.label === 'SL' ? s.levelSl : undefined}>{p.text}</span>
            </span>
          ))}
        </button>
        <span className={s.levelDivider} />
        <button type="button" className={s.levelTrash} aria-label={`Remove ${title.split(' · ')[0]}`} onClick={onRemove} data-testid={`${testId}-remove`}>
          <Trash2 size={18} strokeWidth={1.3} />
        </button>
      </div>
    </div>
  );
}
