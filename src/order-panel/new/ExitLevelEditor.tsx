import { ChevronLeft, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { pricePrecision, qtyPrecision } from '../../config/symbols';
import { fmtQty } from '../../lib/format';
import type { ExitKind, ExitUnit } from '../../lib/orderMath';
import { useTicketStore, type OrderTicket } from '../../order-ticket/ticketStore';
import type { LevelState } from '../../order-ticket/types';
import { SymbolLogo } from '../../ui/SymbolLogo';
import styles from './ExitLevelEditor.module.css';
import {
  EXIT_UNITS,
  exitTitle,
  exitUnitBlocked,
  exitUnitInfo,
  exitUnitLabel,
  formatExitInput,
  levelMenuValue,
  levelPercentText,
  levelText,
  orderTitleText,
  unitsText,
} from './presenters';
import { FieldCaption, FieldLabelMenu, ValueField } from './ui/atoms';

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

type Props = {
  ticket: OrderTicket;
  /** Data index of the level (TicketState.levels). */
  index: number;
  /** The levels as they were when the editor opened (Discard restores them). */
  snapshot: LevelState[];
  onClose: () => void;
};

/**
 * Editor of one level: its shares and its take profit / stop loss with the same unit menus as the single-level fields.
 * Edits apply at once (the list and the chart follow); Discard restores the snapshot, Confirm drops levels left with 0 shares.
 */
export function ExitLevelEditor({ ticket, index, snapshot, onClose }: Props) {
  const { state, view, slowView, spec } = ticket;
  const t = useTicketStore.getState();
  const level = state.levels[index];
  const v = view.levels[index];
  const [qtyText, setQtyText] = useState(() => (v ? fmtQty(v.qty, spec) : ''));
  const n = view.levelOrder.indexOf(index) + 1;
  const discard = () => {
    t.setLevels(snapshot);
    onClose();
  };
  const confirm = () => {
    t.pruneLevels(view);
    onClose();
  };
  // The level was removed (shares → 0 and pruned elsewhere): leave quietly.
  if (!level || !v) return null;

  const leg = (kind: ExitKind) => {
    const x = level[kind];
    const lv = v[kind];
    const sv = slowView.levels[index] ?? v;
    const text = levelText(kind, x.unit, lv.level, state.side, spec, v.qty > 0, lv.level?.money);
    const decimals = x.unit === 'price' ? pricePrecision(spec) : x.unit === 'ticks' ? 0 : 2;
    return (
      <div className={styles.field} data-testid={`nt-e-${kind}`}>
        <div className={styles.label}>
          <FieldLabelMenu<ExitUnit>
            label={`${exitTitle(kind)} ${exitUnitLabel(kind, x.unit)}`}
            value={x.unit}
            options={EXIT_UNITS.map((u) => ({
              value: u,
              label: capitalize(exitUnitLabel(kind, u)),
              end: levelMenuValue(u, x, sv[kind].level, sv.qty > 0, spec),
              info: exitUnitInfo(kind, u),
              disabled: !!(kind === 'sl' && exitUnitBlocked(kind, u, state)),
              disabledReason: kind === 'sl' ? (exitUnitBlocked(kind, u, state) ?? undefined) : undefined,
            }))}
            onChange={(u) => t.setLevelLegUnit(index, kind, u, view)}
            testId={`nt-e-${kind}-unit`}
          />
        </div>
        <ValueField
          value={x.input}
          display={formatExitInput(x.input, x.unit, spec)}
          onChange={(text2) => t.setLevelLeg(index, kind, text2)}
          placeholder="Off"
          placeholderStyle="text"
          right={text.right}
          rightTone="neutral"
          state={lv.error ? 'error' : 'default'}
          step={x.unit === 'price' ? spec.tickSize : 1}
          decimals={decimals}
          ariaLabel={`Exit ${n} ${exitTitle(kind).toLowerCase()}`}
          testId={`nt-e-${kind}-input`}
        />
        {(lv.error || text.caption) && <FieldCaption tone={lv.error ? 'error' : text.captionTone}>{lv.error ?? text.caption}</FieldCaption>}
      </div>
    );
  };

  return (
    <div className={styles.screen} data-testid="exit-editor">
      <div className={styles.header}>
        <button type="button" className={styles.headerBtn} aria-label="Back" onClick={discard} data-testid="nt-editor-back">
          <ChevronLeft size={22} strokeWidth={1.3} />
        </button>
        <span className={styles.headerTitle}>Exit {n}</span>
        <button type="button" className={styles.headerBtn} aria-label="Close" onClick={discard}>
          <X size={22} strokeWidth={1.3} />
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.order}>
          <SymbolLogo symbol={spec.symbol} size={40} />
          <div className={styles.orderText}>
            <span className={styles.orderSymbol}>{spec.symbol}</span>
            <span className={styles.muted} data-testid="nt-editor-order">
              {orderTitleText(state, view, spec)}
            </span>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.field}>
            <div className={styles.label}>
              <span className={styles.staticLabel}>{spec.qtyLabel}</span>
            </div>
            <ValueField
              value={qtyText}
              onChange={(x) => {
                setQtyText(x);
                t.setLevelQty(index, x, view);
              }}
              placeholder="0"
              right={`${levelPercentText(v.percent)} · ${unitsText(v.qty, spec)}`}
              rightTone="neutral"
              state={view.exitsCaption ? 'error' : 'default'}
              step={spec.qtyStep}
              decimals={qtyPrecision(spec)}
              ariaLabel={`Exit ${n} shares`}
              testId="nt-e-qty"
            />
            {view.exitsCaption && (
              <FieldCaption tone="error" testId="nt-e-caption">
                {view.exitsCaption}
              </FieldCaption>
            )}
            {!view.exitsCaption && qtyText.trim() !== '' && v.qty === 0 && <FieldCaption tone="neutral">A level without shares is removed on Confirm</FieldCaption>}
          </div>
          {leg('tp')}
          {leg('sl')}
        </div>

        <div className={styles.add}>
          <button
            type="button"
            className={styles.removeLevel}
            onClick={() => {
              t.removeLevel(index, view);
              onClose();
            }}
            data-testid="nt-editor-remove"
          >
            <Trash2 size={18} strokeWidth={1.3} /> Remove exit
          </button>
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.confirm} onClick={confirm} data-testid="nt-editor-confirm">
          Confirm
        </button>
        <button type="button" className={styles.discard} onClick={discard} data-testid="nt-editor-discard">
          Discard
        </button>
      </div>
    </div>
  );
}
