import { Ellipsis, Grid2x2Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { logEvent } from '../../analytics/eventLog';
import { getSpec, pricePrecision, qtyPrecision } from '../../config/symbols';
import { fmtNumber, fmtPrice, fmtQty } from '../../lib/format';
import type { ExitKind, OrderType } from '../../lib/orderMath';
import { useTicketStore, type OrderTicket } from '../../order-ticket/ticketStore';
import { now, useTradingStore } from '../../store/tradingStore';
import { useUiStore } from '../../store/uiStore';
import { Checkbox } from '../../ui/Switch';
import { SymbolLogo } from '../../ui/SymbolLogo';
import styles from './NewOrderPanel.module.css';
import {
  EXIT_UNITS,
  QTY_UNITS_2A,
  exitMenuValue,
  exitPlaceholder,
  exitText,
  exitTitle,
  exitUnitLabel,
  fillToastText,
  formatExitInput,
  formatQtyInput,
  qtyMenuValue,
  qtyText,
  qtyUnitLabel,
  riskRewardText,
  submitText,
  summaryText,
  tifText,
} from './presenters';
import {
  ExitLevel,
  FieldCaption,
  FieldLabelMenu,
  InfoRow,
  OrderSummary,
  SegmentedControl,
  SettingsRow,
  SideToggle,
  SubmitButton,
  TextButton,
  UnderlineTabs,
  ValueField,
} from './ui/atoms';

const TYPES: { id: OrderType; label: string; disabled?: boolean }[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit', disabled: true },
  { id: 'stop', label: 'Stop', disabled: true },
];

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Redesigned order ticket (step 2a: Market). A thin view over useOrderTicket(); no math here. */
export function NewOrderPanel({ ticket }: { ticket: OrderTicket }) {
  const { state, view, spec } = ticket;
  const t = useTicketStore.getState();
  const [tab, setTab] = useState<'order' | 'dom'>('order');
  const [exitsOpen, setExitsOpen] = useState(true);
  const [extraOpen, setExtraOpen] = useState(false);
  const [typeHint, setTypeHint] = useState(false);

  const qty = qtyText(state, view, spec);
  const submit = submitText(state, view, spec);
  const summary = view.canSubmit && !view.marginExceeded ? summaryText(view) : null;

  // Log each distinct validation error the user runs into (once per change).
  const lastReason = useRef<string | null>(null);
  useEffect(() => {
    const isError = submit.reason && !submit.reason.startsWith('Enter quantity') && !submit.reason.startsWith('Waiting');
    const key = isError ? submit.reason : null;
    if (key && key !== lastReason.current) logEvent('validation_error', { reason: key });
    lastReason.current = key;
  }, [submit.reason]);

  const doSubmit = () => {
    if (submit.disabled || !view.draft) {
      logEvent('validation_error', { reason: submit.reason, trigger: 'submit-attempt' });
      return;
    }
    const events = t.submit(view, { silent: true });
    const filled = events.find((e) => e.type === 'filled' && e.order?.role === 'entry');
    const rejected = events.find((e) => e.type === 'rejected');
    const trading = useTradingStore.getState();
    if (filled?.order && filled.order.fillPrice !== undefined) {
      const order = filled.order;
      const orderSpec = getSpec(order.symbol);
      trading.pushToast({
        type: 'filled',
        time: filled.time,
        symbol: order.symbol,
        title: fillToastText(order.side, order.qty, order.fillPrice!, orderSpec),
        message: '',
        ttl: 8000,
        action: {
          label: 'Close position',
          run: () => {
            const closing = useTradingStore.getState().reverseTrade(order.id);
            const fill = closing.find((e) => e.type === 'filled');
            if (fill?.order?.fillPrice !== undefined) {
              useTradingStore.getState().pushToast({
                type: 'positionClosed',
                time: fill.time,
                symbol: order.symbol,
                title: `Closed ${fmtQty(order.qty, orderSpec)} ${order.symbol} at ${fmtPrice(fill.order.fillPrice, orderSpec)}`,
                message: '',
              });
            }
          },
        },
      });
      t.clearQty();
    } else if (rejected) {
      trading.pushToast({ ...rejected });
    }
  };

  const exitBlock = (kind: ExitKind) => {
    const ex = view[kind];
    const text = exitText(kind, state, view, spec);
    const decimals = ex.unit === 'price' ? pricePrecision(spec) : ex.unit === 'ticks' ? 0 : 2;
    return (
      <ExitLevel
        testId={`nt-${kind}`}
        title={exitTitle(kind)}
        label={`${exitTitle(kind)} ${exitUnitLabel(kind, ex.unit)}`}
        unit={ex.unit}
        units={EXIT_UNITS.map((u) => ({ value: u, label: capitalize(exitUnitLabel(kind, u)), end: exitMenuValue(kind, u, view, spec) }))}
        onUnit={(u) => t.setExitUnit(kind, u, view)}
        enabled={ex.enabled}
        onToggle={(v) => t.setExitEnabled(kind, v, view)}
        field={{
          value: ex.enabled ? ex.input : '',
          display: ex.enabled ? formatExitInput(ex.input, ex.unit, spec) : '',
          onChange: (v) => t.setExitInput(kind, v),
          placeholder: exitPlaceholder(ex.unit),
          suffix: text.suffix,
          right: text.right,
          rightTone: text.rightTone,
          state: text.captionTone === 'error' ? 'error' : 'default',
          step: ex.unit === 'price' ? spec.tickSize : 1,
          decimals,
          onEnter: doSubmit,
          ariaLabel: exitTitle(kind),
          testId: `nt-${kind}-input`,
        }}
        caption={text.caption}
        captionTone={text.captionTone}
      />
    );
  };

  const slHasCaption = view.sl.enabled && !!exitText('sl', state, view, spec).caption;

  return (
    <div className={styles.panel} data-testid="order-panel" data-variant="new">
      <Header symbol={spec.symbol} />
      <div className={styles.px}>
        <SegmentedControl
          items={[
            { id: 'order', label: 'Order' },
            { id: 'dom', label: 'DOM' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'dom' ? (
        <div className={styles.domStub}>Depth of Market is not available in this prototype.</div>
      ) : (
        <>
          <div className={styles.scroll}>
            <div className={`${styles.px} ${styles.bs}`}>
              <SideToggle
                side={state.side}
                bid={view.ready ? fmtPrice(view.bid, spec) : '—'}
                ask={view.ready ? fmtPrice(view.ask, spec) : '—'}
                spread={view.ready ? fmtNumber(view.spread, pricePrecision(spec), { grouping: false }) : ''}
                onChange={t.setSide}
              />
              <div className={styles.typeWrap}>
                <UnderlineTabs
                  items={TYPES}
                  value={state.type}
                  onChange={(id) => {
                    if (id === 'market') t.setType(id);
                    else {
                      setTypeHint(true);
                      setTimeout(() => setTypeHint(false), 1500);
                    }
                  }}
                />
                {typeHint && <span className={styles.hint}>Limit and Stop are coming soon</span>}
              </div>
            </div>

            {/* Quantity */}
            <div className={`${styles.px} ${styles.qty}`}>
              <div className={styles.qtyLabel}>
                <FieldLabelMenu
                  label={qtyUnitLabel(state.qtyUnit, spec)}
                  value={state.qtyUnit}
                  options={QTY_UNITS_2A.map(({ unit, enabled }) => ({
                    value: unit,
                    label: qtyUnitLabel(unit, spec),
                    end: enabled ? qtyMenuValue(unit, view, spec) : undefined,
                    disabled: !enabled,
                  }))}
                  onChange={(u) => t.setQtyUnit(u, view)}
                  testId="nt-qty-unit"
                />
              </div>
              <ValueField
                value={state.qtyInput}
                display={formatQtyInput(state.qtyInput, state.qtyUnit, spec)}
                onChange={t.setQtyInput}
                placeholder="0"
                suffix={qty.suffix}
                right={qty.right}
                state={qty.captionTone === 'error' ? 'error' : 'default'}
                step={state.qtyUnit === 'units' ? spec.qtyStep : 1}
                decimals={state.qtyUnit === 'units' ? qtyPrecision(spec) : 2}
                onEnter={doSubmit}
                ariaLabel="Quantity"
                testId="nt-qty"
              />
              {qty.caption && (
                <FieldCaption tone={qty.captionTone} testId="nt-qty-caption">
                  {qty.caption}
                </FieldCaption>
              )}
            </div>

            {/* Exits */}
            <div className={`${styles.px} ${styles.section}`}>
              <SettingsRow title="Exits" chevron={exitsOpen ? 'up' : 'down'} onClick={() => setExitsOpen((v) => !v)} testId="nt-exits-toggle" />
              {exitsOpen && (
                <div className={styles.exits}>
                  {exitBlock('sl')}
                  <div style={{ height: slHasCaption ? 12 : 16 }} />
                  {exitBlock('tp')}
                  {view.riskReward !== null && (
                    <div className={styles.rr}>
                      <InfoRow label={'Risk / Reward'} value={riskRewardText(view.riskReward)} />
                    </div>
                  )}
                  {(state.sl.enabled || state.tp.enabled) && (
                    <div className={styles.addLevel}>
                      <TextButton tooltip="Coming soon">Add level</TextButton>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Time in force (not expandable in 2a) */}
            <div className={`${styles.px} ${styles.section}`}>
              <SettingsRow title="Time in force" value={tifText(state.tif, now())} chevron="right" testId="nt-tif" />
            </div>

            {/* Extra settings */}
            <div className={`${styles.px} ${styles.section} ${styles.last}`}>
              <SettingsRow title="Extra settings" chevron={extraOpen ? 'up' : 'down'} onClick={() => setExtraOpen((v) => !v)} testId="nt-extra" />
              {extraOpen && (
                <div className={styles.extra}>
                  <Checkbox checked={state.fillOutsideRth} onChange={t.setFillOutsideRth} label="Fill order outside RTH" />
                </div>
              )}
            </div>
          </div>

          <div className={styles.footer}>
            <OrderSummary text={summary}>
              <SubmitButton side={state.side} primary={submit.primary} secondary={submit.secondary} disabled={submit.disabled} onClick={doSubmit} />
            </OrderSummary>
          </div>
        </>
      )}
    </div>
  );
}

function Header({ symbol }: { symbol: string }) {
  const closeTicket = useUiStore((s) => s.closeTicket);
  return (
    <div className={styles.header}>
      <div className={styles.title}>
        <SymbolLogo symbol={symbol} size={24} />
        <span className={styles.symbol}>{symbol}</span>
        <span className={styles.status} title="Simulated / delayed data">
          ≈
        </span>
      </div>
      <button type="button" className={styles.headerBtn} aria-label="Layout" title="Layout">
        <Grid2x2Plus size={22} strokeWidth={1.3} />
      </button>
      <button type="button" className={styles.headerBtn} aria-label="More" title="More">
        <Ellipsis size={22} strokeWidth={1.3} />
      </button>
      <button type="button" className={styles.headerBtn} aria-label="Close order panel" onClick={closeTicket} data-testid="close-ticket">
        <X size={22} strokeWidth={1.3} />
      </button>
    </div>
  );
}
