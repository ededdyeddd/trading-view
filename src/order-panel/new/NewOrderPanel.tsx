import { Ellipsis, Grid2x2Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { logEvent } from '../../analytics/eventLog';
import { getSpec, pricePrecision, qtyPrecision } from '../../config/symbols';
import { fmtNumber, fmtPrice, fmtQty } from '../../lib/format';
import type { ExitKind, OrderType } from '../../lib/orderMath';
import { useTicketStore, type OrderTicket } from '../../order-ticket/ticketStore';
import { now, useTradingStore } from '../../store/tradingStore';
import { useUiStore } from '../../store/uiStore';
import { MenuItem, Popover } from '../../ui/Popover';
import { Checkbox } from '../../ui/Switch';
import { SymbolLogo } from '../../ui/SymbolLogo';
import styles from './NewOrderPanel.module.css';
import {
  QTY_UNITS,
  TIFS,
  exitMenuValue,
  exitPlaceholder,
  exitText,
  exitTitle,
  exitUnitBlocked,
  exitUnitsFor,
  exitUnitInfo,
  exitUnitLabel,
  fillToastText,
  formatExitInput,
  formatQtyInput,
  levelText,
  marketClosedText,
  percentLeftText,
  placedToastText,
  priceLabel,
  priceSwapLabel,
  priceText,
  qtyMenuValue,
  qtyPlaceholder,
  qtyText,
  qtyUnitInfo,
  qtyUnitLabel,
  riskRewardText,
  submitText,
  summaryParts,
  tifMenuText,
  tifRowText,
} from './presenters';
import {
  Banner,
  DateTimeField,
  ExitLevel,
  FieldCaption,
  FieldLabelMenu,
  IconButton,
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

const TYPES: { id: OrderType; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop', label: 'Stop' },
];

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Redesigned order ticket: Market / Limit / Stop, risk-first sizing. A thin view over useOrderTicket(); no math here.
 * Grey placeholders and live values in unit menus read `slowView` (the market at most every 500 ms).
 */
export function NewOrderPanel({ ticket }: { ticket: OrderTicket }) {
  const { state, view, slowView, labelQuote, spec, quote } = ticket;
  const t = useTicketStore.getState();
  const [tab, setTab] = useState<'order' | 'dom'>('order');
  const [exitsOpen, setExitsOpen] = useState(true);
  const [extraOpen, setExtraOpen] = useState(false);
  const [tifOpen, setTifOpen] = useState(false);
  const tifRef = useRef<HTMLDivElement>(null);

  const price = priceText(state, view, spec, labelQuote);
  const pricePh = priceText(state, slowView, spec);
  const qty = qtyText(state, state.qtyInput.trim() === '' ? slowView : view, spec);
  const qtyPh = qtyPlaceholder(state, slowView, spec);
  const submit = submitText(state, view, spec);
  const summary = view.canSubmit ? summaryParts(view) : null;
  const leftText = percentLeftText(view);

  // Log each distinct validation error the user runs into (once per change).
  const lastReason = useRef<string | null>(null);
  useEffect(() => {
    // Prompts that are part of the normal flow ("Enter …", "Set stop loss to calculate size") are not errors.
    const quiet = !submit.reason || /^(Enter|Waiting|Set stop loss)/.test(submit.reason);
    const key = quiet ? null : submit.reason;
    if (key && key !== lastReason.current) logEvent('validation_error', { reason: key });
    lastReason.current = key;
  }, [submit.reason]);

  const doSubmit = () => {
    if (submit.disabled || !view.draft) {
      logEvent('validation_error', { reason: submit.reason, trigger: 'submit-attempt' });
      return;
    }
    // The price turned "Fills now" / "Triggers now" since the last check: show the warning first, the next click sends.
    if (!t.checkPriceOnSubmit()) {
      logEvent('validation_error', { reason: 'price-moved', trigger: 'submit-attempt' });
      return;
    }
    const events = t.submit(view, { silent: true });
    const entryFill = events.find((e) => e.type === 'filled' && e.order?.role === 'entry');
    const placed = events.find((e) => e.type === 'placed' && e.order?.role === 'entry');
    const rejected = events.find((e) => e.type === 'rejected');
    const trading = useTradingStore.getState();
    if (rejected) {
      trading.pushToast({ ...rejected });
      return;
    }
    if (entryFill?.order && entryFill.order.fillPrice !== undefined) {
      const order = entryFill.order;
      const orderSpec = getSpec(order.symbol);
      trading.pushToast({
        type: 'filled',
        time: entryFill.time,
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
    } else if (placed?.order) {
      const order = placed.order;
      const orderSpec = getSpec(order.symbol);
      const px = order.type === 'limit' ? order.limitPrice : order.type === 'stop' ? order.stopPrice : undefined;
      trading.pushToast({
        type: 'placed',
        time: placed.time,
        symbol: order.symbol,
        title: placedToastText(order.side, order.type, order.qty, px, orderSpec),
        message: '',
        ttl: 8000,
        action: { label: 'Cancel', run: () => useTradingStore.getState().cancelOrder(order.id) },
      });
    }
    t.clearQty();
  };

  const exitBlock = (kind: ExitKind, aside?: ReactNode) => {
    const ex = view[kind];
    const ph = slowView[kind].placeholder;
    const text = exitText(kind, state, ex.enabled ? view : slowView, spec);
    const decimals = ex.unit === 'price' ? pricePrecision(spec) : ex.unit === 'ticks' ? 0 : 2;
    return (
      <ExitLevel
        testId={`nt-${kind}`}
        title={exitTitle(kind)}
        label={`${exitTitle(kind)}${kind === 'tp' && view.tpLevels.length > 1 && state.tp.enabled ? ' 1' : ''} ${exitUnitLabel(kind, ex.unit)}`}
        unit={ex.unit}
        units={exitUnitsFor().map((u) => ({
          value: u,
          label: capitalize(exitUnitLabel(kind, u)),
          end: exitMenuValue(kind, u, state, slowView, spec),
          info: exitUnitInfo(kind, u),
          disabled: !!exitUnitBlocked(kind, u, state),
          disabledReason: exitUnitBlocked(kind, u, state) ?? undefined,
        }))}
        onUnit={(u) => t.setExitUnit(kind, u, view)}
        enabled={ex.enabled}
        onToggle={(v) => t.setExitEnabled(kind, v, slowView)}
        aside={aside}
        field={{
          value: ex.enabled ? ex.input : '',
          display: ex.enabled ? formatExitInput(ex.input, ex.unit, spec) : '',
          onChange: (v) => t.setExitInput(kind, v),
          placeholder: ph ? formatExitInput(ph, ex.unit, spec) : exitPlaceholder(),
          placeholderStyle: ph ? 'value' : 'text',
          fill: ph || undefined,
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

  const percentField = (index: number) => {
    const raw = index === 0 ? state.tpPercent : (state.tpLevels[index - 1]?.percent ?? '');
    return (
      <div className={styles.percent}>
        <ValueField
          value={raw}
          onChange={(v) => t.setTpPercent(index, v)}
          placeholder={String(view.tpLevels[index]?.percent ?? 0)}
          suffix="%"
          disabled={!state.tp.enabled}
          onActivate={() => t.setExitEnabled('tp', true, slowView)}
          ariaLabel={`Take profit ${index + 1}, % of position`}
          testId={`nt-tp${index + 1}-percent`}
          onEnter={doSubmit}
        />
      </div>
    );
  };

  const multi = state.tp.enabled && view.tpLevels.length > 1;
  const slHasCaption = view.sl.enabled && !!exitText('sl', state, view, spec).caption;
  const today = now();

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
            {view.opensAt !== null && (
              <div className={`${styles.px} ${styles.banner}`}>
                <Banner testId="nt-market-closed">{marketClosedText(view.opensAt)}</Banner>
              </div>
            )}
            <div className={`${styles.px} ${styles.bs}`}>
              <SideToggle
                side={state.side}
                bid={quote ? fmtPrice(quote.bid, spec) : '—'}
                ask={quote ? fmtPrice(quote.ask, spec) : '—'}
                spread={quote ? fmtNumber(quote.ask - quote.bid, pricePrecision(spec), { grouping: false }) : ''}
                onChange={t.setSide}
              />
              <div className={styles.typeWrap}>
                <UnderlineTabs items={TYPES} value={state.type} onChange={t.setType} />
              </div>
            </div>

            {/* Limit / Stop price — the only block the order type changes */}
            {state.type !== 'market' && (
              <div className={`${styles.px} ${styles.qty}`}>
                <div className={styles.qtyLabel}>
                  <span className={styles.staticLabel} data-testid="nt-price-label">
                    {priceLabel(state.type, state.priceUnit, state.side)}
                  </span>
                </div>
                <ValueField
                  value={state.priceInput}
                  onChange={t.setPriceInput}
                  onCommit={t.commitPrice}
                  placeholder={pricePh.placeholder}
                  fill={pricePh.fill}
                  suffix={price.suffix}
                  right={state.priceInput.trim() === '' ? pricePh.right : price.right}
                  rightTone={state.priceInput.trim() === '' ? pricePh.rightTone : price.rightTone}
                  state={price.captionTone === 'warning' ? 'warning' : 'default'}
                  step={spec.tickSize}
                  decimals={pricePrecision(spec)}
                  signed={state.priceUnit === 'offset'}
                  swap={{
                    label: priceSwapLabel(state.priceUnit, state.side),
                    onClick: () => t.setPriceUnit(state.priceUnit === 'price' ? 'offset' : 'price', view),
                    testId: 'nt-price-swap',
                  }}
                  onEnter={doSubmit}
                  ariaLabel={priceLabel(state.type, state.priceUnit, state.side)}
                  testId="nt-price"
                />
                {price.caption && (
                  <FieldCaption tone={price.captionTone} testId="nt-price-caption">
                    {price.caption}
                  </FieldCaption>
                )}
              </div>
            )}

            {/* Quantity */}
            <div className={`${styles.px} ${styles.qty}`}>
              <div className={styles.qtyLabel}>
                <FieldLabelMenu
                  label={qtyUnitLabel(state.qtyUnit, spec)}
                  value={state.qtyUnit}
                  options={QTY_UNITS.map((unit) => ({
                    value: unit,
                    label: qtyUnitLabel(unit, spec),
                    end: qtyMenuValue(unit, state, slowView, spec),
                    info: qtyUnitInfo(unit, spec),
                  }))}
                  onChange={(u) => t.setQtyUnit(u, view)}
                  testId="nt-qty-unit"
                />
              </div>
              <ValueField
                value={state.qtyInput}
                display={formatQtyInput(state.qtyInput, state.qtyUnit, spec)}
                onChange={t.setQtyInput}
                placeholder={qtyPh.placeholder}
                fill={qtyPh.fill || undefined}
                suffix={qty.suffix}
                right={qty.right}
                rightTone={qty.rightTone}
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
                  {exitBlock('tp', multi ? percentField(0) : undefined)}
                  {multi &&
                    state.tpLevels.map((l, i) => {
                      const index = i + 1;
                      const lv = view.tpLevels[index];
                      const text = levelText('tp', state.tp.unit, lv?.level ?? null, state.side, spec, view.qty.units > 0, lv?.money ?? undefined);
                      return (
                        <div key={index} className={styles.level} data-testid={`nt-tp${index + 1}`}>
                          <div className={styles.levelHeader}>
                            <span className={styles.levelTitle}>
                              Take profit {index + 1} {exitUnitLabel('tp', state.tp.unit)}
                            </span>
                            <IconButton label={`Remove take profit ${index + 1}`} onClick={() => t.removeTpLevel(index)} testId={`nt-tp${index + 1}-remove`} />
                          </div>
                          <div className={styles.levelRow}>
                            <div className={styles.levelValue}>
                              <ValueField
                                value={l.input}
                                display={formatExitInput(l.input, state.tp.unit, spec)}
                                onChange={(v) => t.setTpLevelInput(index, v)}
                                placeholder={exitPlaceholder()}
                                placeholderStyle="text"
                                suffix={text.suffix}
                                right={text.right}
                                rightTone={text.rightTone}
                                state={text.captionTone === 'error' ? 'error' : 'default'}
                                step={state.tp.unit === 'price' ? spec.tickSize : 1}
                                decimals={state.tp.unit === 'price' ? pricePrecision(spec) : 0}
                                onEnter={doSubmit}
                                ariaLabel={`Take profit ${index + 1}`}
                                testId={`nt-tp${index + 1}-input`}
                              />
                            </div>
                            {percentField(index)}
                          </div>
                          {text.caption && <FieldCaption tone={text.captionTone}>{text.caption}</FieldCaption>}
                        </div>
                      );
                    })}
                  {leftText && (
                    <FieldCaption tone="neutral" testId="nt-percent-left">
                      {leftText}
                    </FieldCaption>
                  )}
                  {view.riskReward !== null && (
                    <div className={styles.rr}>
                      <InfoRow label={'Risk / Reward'} value={riskRewardText(view.riskReward)} />
                    </div>
                  )}
                  {state.tp.enabled && state.tpLevels.length < 2 && (
                    <div className={`${styles.addLevel} ${view.riskReward === null ? styles.addLevelAlone : ''}`}>
                      <TextButton onClick={() => t.addTpLevel(view)}>Add level</TextButton>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Time in force */}
            <div className={`${styles.px} ${styles.section}`}>
              <div ref={tifRef}>
                <SettingsRow
                  title="Time in force"
                  value={tifRowText(state, today)}
                  chevron={tifOpen ? 'up' : 'right'}
                  onClick={() => setTifOpen((v) => !v)}
                  testId="nt-tif"
                />
              </div>
              <Popover anchor={tifRef} open={tifOpen} onClose={() => setTifOpen(false)} align="end">
                {TIFS.map((tif) => (
                  <MenuItem
                    key={tif}
                    active={tif === state.tif}
                    onSelect={() => {
                      if (tif === 'gtd') t.setGtd(state.gtdDate || ymd(today + 86_400_000), state.gtdTime);
                      else t.setTif(tif);
                      setTifOpen(false);
                    }}
                  >
                    <span data-testid={`nt-tif-${tif}`}>{tifMenuText(tif, today, state)}</span>
                  </MenuItem>
                ))}
              </Popover>
              {state.tif === 'gtd' && (
                <div className={styles.extra}>
                  <DateTimeField date={state.gtdDate} time={state.gtdTime} minDate={ymd(today + 86_400_000)} onChange={(d, tm) => t.setGtd(d, tm)} />
                </div>
              )}
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
            <OrderSummary parts={summary}>
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
