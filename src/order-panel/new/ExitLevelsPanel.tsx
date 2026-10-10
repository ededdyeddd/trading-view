import { ChevronLeft, Trash2, X } from 'lucide-react';
import { pricePrecision, qtyPrecision } from '../../config/symbols';
import { fmtNumber } from '../../lib/format';
import type { ExitKind, ExitLevel, ExitUnit } from '../../lib/orderMath';
import { MAX_PARTIALS, useTicketStore, type OrderTicket } from '../../order-ticket/ticketStore';
import type { PartialState } from '../../order-ticket/types';
import { SymbolLogo } from '../../ui/SymbolLogo';
import styles from './ExitLevelsPanel.module.css';
import {
  DASH,
  EXIT_UNITS,
  exitTitle,
  exitUnitBlocked,
  exitUnitInfo,
  exitUnitLabel,
  formatExitInput,
  levelHeadingText,
  levelMenuValue,
  levelText,
  orderTitleText,
  riskRewardText,
} from './presenters';
import { FieldCaption, FieldLabelMenu, TextButton, ValueField } from './ui/atoms';

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

type Props = {
  ticket: OrderTicket;
  /** The partial exits as they were when the screen opened (Discard restores them). */
  snapshot: PartialState[];
  /** Leave the screen (Confirm keeps the edits, Discard / back / × restore the snapshot first). */
  onClose: () => void;
};

/**
 * "Exit levels": Level 1 is the stop loss / take profit of the main panel with the shares that remain; every further
 * level has its own shares, take profit and stop loss. Edits apply live (chart lines follow); Discard restores the snapshot.
 */
export function ExitLevelsPanel({ ticket, snapshot, onClose }: Props) {
  const { state, view, slowView, spec } = ticket;
  const t = useTicketStore.getState();
  const discard = () => {
    t.setPartials(snapshot);
    onClose();
  };
  const canAdd = state.partials.length < MAX_PARTIALS && view.level1Qty >= 2 * spec.minQty;
  const level1Percent = view.qty.units > 0 ? (view.level1Qty / view.qty.units) * 100 : 0;
  const protectedFull = view.protectedPercent >= 99.995;

  type LegProps = {
    kind: ExitKind;
    /** test-id prefix: "nt-p2-tp" */
    id: string;
    ariaLabel: string;
    unit: ExitUnit;
    input: string;
    placeholder: string;
    level: ExitLevel | null;
    menuLevel: ExitLevel | null;
    hasQty: boolean;
    error: string | null;
    onInput: (text: string) => void;
    onUnit: (unit: ExitUnit) => void;
    blocked?: (unit: ExitUnit) => string | null;
  };
  const legField = (l: LegProps) => {
    const text = levelText(l.kind, l.unit, l.level, state.side, spec, l.hasQty, l.level?.money);
    const decimals = l.unit === 'price' ? pricePrecision(spec) : l.unit === 'ticks' ? 0 : 2;
    return (
      <div className={styles.field} data-testid={l.id}>
        <div className={styles.label}>
          <FieldLabelMenu<ExitUnit>
            label={`${exitTitle(l.kind)} ${exitUnitLabel(l.kind, l.unit)}`}
            value={l.unit}
            options={EXIT_UNITS.map((u) => ({
              value: u,
              label: capitalize(exitUnitLabel(l.kind, u)),
              end: levelMenuValue(u, { unit: l.unit, input: l.input }, l.menuLevel, l.hasQty, spec),
              info: exitUnitInfo(l.kind, u),
              disabled: !!l.blocked?.(u),
              disabledReason: l.blocked?.(u) ?? undefined,
            }))}
            onChange={l.onUnit}
            testId={`${l.id}-unit`}
          />
        </div>
        <ValueField
          value={l.input}
          display={formatExitInput(l.input, l.unit, spec)}
          onChange={l.onInput}
          placeholder={l.placeholder}
          placeholderStyle="text"
          right={text.right}
          rightTone="neutral"
          state={l.error ? 'error' : 'default'}
          step={l.unit === 'price' ? spec.tickSize : 1}
          decimals={decimals}
          ariaLabel={l.ariaLabel}
          testId={`${l.id}-input`}
        />
        {(l.error || text.caption) && <FieldCaption tone={l.error ? 'error' : text.captionTone}>{l.error ?? text.caption}</FieldCaption>}
      </div>
    );
  };

  const leg = (kind: ExitKind, index: number) => {
    const p = state.partials[index];
    const v = view.partials[index];
    const sv = slowView.partials[index] ?? v;
    return legField({
      kind,
      id: `nt-p${index + 2}-${kind}`,
      ariaLabel: `Level ${index + 2} ${exitTitle(kind).toLowerCase()}`,
      unit: p[kind].unit,
      input: p[kind].input,
      placeholder: DASH,
      level: v[kind].level,
      menuLevel: sv[kind].level,
      hasQty: v.qty > 0,
      error: v[kind].error,
      onInput: (x) => t.setPartialLeg(index, kind, x),
      onUnit: (u) => t.setPartialLegUnit(index, kind, u, view),
    });
  };

  /** Level 1 = the main stop loss / take profit. */
  const leg1 = (kind: ExitKind) => {
    const ex = view[kind];
    const ph = slowView[kind].placeholder;
    return legField({
      kind,
      id: `nt-l1-${kind}`,
      ariaLabel: `Level 1 ${exitTitle(kind).toLowerCase()}`,
      unit: ex.unit,
      input: ex.enabled ? ex.input : '',
      placeholder: ph ? formatExitInput(ph, ex.unit, spec) : DASH,
      level: ex.enabled ? ex.level : null,
      menuLevel: slowView[kind].level ?? slowView[kind].placeholderLevel,
      hasQty: view.level1Qty > 0,
      error: ex.enabled ? ex.error : null,
      onInput: (x) => t.setLevel1Leg(kind, x),
      onUnit: (u) => t.setExitUnit(kind, u, view),
      blocked: (u) => exitUnitBlocked(kind, u, state),
    });
  };

  return (
    <div className={styles.screen} data-testid="exit-levels">
      <div className={styles.header}>
        <button type="button" className={styles.headerBtn} aria-label="Back" onClick={discard} data-testid="nt-levels-back">
          <ChevronLeft size={22} strokeWidth={1.3} />
        </button>
        <span className={styles.headerTitle}>Exit levels</span>
        <button type="button" className={styles.headerBtn} aria-label="Close" onClick={discard}>
          <X size={22} strokeWidth={1.3} />
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.order}>
          <SymbolLogo symbol={spec.symbol} size={40} />
          <div className={styles.orderText}>
            <span className={styles.orderSymbol}>{spec.symbol}</span>
            <span className={styles.muted} data-testid="nt-levels-order">
              {orderTitleText(state, view, spec)}
            </span>
          </div>
        </div>

        <div className={styles.stat}>
          <span>Protected size · {fmtNumber(view.protectedPercent, 2)}%</span>
        </div>
        <div className={styles.bar} role="progressbar" aria-valuenow={Math.round(view.protectedPercent)} aria-label="Protected size">
          <div className={protectedFull ? styles.barFill : `${styles.barFill} ${styles.barPartial}`} style={{ width: `${view.protectedPercent}%` }} />
        </div>
        <div className={`${styles.stat} ${styles.statRow}`}>
          <span>Risk / Reward</span>
          <span className={styles.value} data-testid="nt-levels-rr">
            {view.riskReward !== null ? riskRewardText(view.riskReward).replace('1 : ', '') : DASH}
          </span>
        </div>

        <div className={styles.levelHead}>
          <span className={styles.muted}>{levelHeadingText(0, level1Percent)}</span>
        </div>
        <div className={styles.card} data-testid="nt-level-1">
          <div className={styles.field}>
            <div className={styles.label}>
              <span className={styles.staticLabel}>{spec.qtyLabel}</span>
            </div>
            <ValueField
              value={fmtNumber(view.level1Qty, qtyPrecision(spec))}
              onChange={() => undefined}
              placeholder="0"
              right={`${fmtNumber(level1Percent, 2)}%`}
              rightTone="neutral"
              disabled
              ariaLabel="Level 1 shares"
              testId="nt-l1-qty"
            />
            <FieldCaption tone="neutral">The rest of the position</FieldCaption>
          </div>
          {leg1('tp')}
          {leg1('sl')}
        </div>

        {state.partials.map((p, i) => {
          const v = view.partials[i];
          const unitsMode = p.qtyUnit === 'units';
          return (
            <div key={i} data-testid={`nt-level-${i + 2}`}>
              <div className={styles.levelHead}>
                <span className={styles.muted}>{levelHeadingText(i + 1, v.percent)}</span>
                <button type="button" className={styles.trash} aria-label={`Remove level ${i + 2}`} onClick={() => t.removePartial(i)} data-testid={`nt-level-${i + 2}-remove`}>
                  <Trash2 size={18} strokeWidth={1.3} />
                </button>
              </div>
              <div className={styles.card}>
                <div className={styles.field}>
                  <div className={styles.label}>
                    <span className={styles.staticLabel}>{unitsMode ? spec.qtyLabel : '% of position'}</span>
                  </div>
                  <ValueField
                    value={p.qtyInput}
                    onChange={(x) => t.setPartialQty(i, x)}
                    placeholder="0"
                    right={unitsMode ? `${fmtNumber(v.percent, 2)}%` : `${fmtNumber(v.qty, qtyPrecision(spec))} ${spec.qtyLabel.toLowerCase()}`}
                    rightTone="neutral"
                    state={v.qtyError && p.qtyInput.trim() !== '' ? 'error' : 'default'}
                    step={unitsMode ? spec.qtyStep : 1}
                    decimals={unitsMode ? qtyPrecision(spec) : 2}
                    swap={{ label: unitsMode ? 'Enter as % of position' : `Enter as ${spec.qtyLabel.toLowerCase()}`, onClick: () => t.setPartialQtyUnit(i, unitsMode ? 'percent' : 'units', view), testId: `nt-level-${i + 2}-swap` }}
                    ariaLabel={`Level ${i + 2} shares`}
                    testId={`nt-level-${i + 2}-qty`}
                  />
                  {v.qtyError && p.qtyInput.trim() !== '' && <FieldCaption tone="error">{v.qtyError}</FieldCaption>}
                </div>
                {leg('tp', i)}
                {leg('sl', i)}
              </div>
            </div>
          );
        })}

        {view.partialsError && state.partials.length > 0 && !state.partials.some((_, i) => view.partials[i].qtyError || view.partials[i].tp.error || view.partials[i].sl.error) && (
          <FieldCaption tone="error" testId="nt-levels-error">
            {view.partialsError}
          </FieldCaption>
        )}

        <div className={styles.add}>
          <TextButton onClick={() => t.addPartial(view)} disabled={!canAdd} disabledReason="No shares left to split" testId="nt-add-level-inner">
            Add level
          </TextButton>
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.confirm} disabled={!!view.partialsError} onClick={onClose} data-testid="nt-levels-confirm">
          Confirm
        </button>
        <button type="button" className={styles.discard} onClick={discard} data-testid="nt-levels-discard">
          Discard
        </button>
      </div>
    </div>
  );
}
