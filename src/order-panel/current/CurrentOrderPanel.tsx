import { ChevronDown, ChevronUp, CircleHelp, LayoutPanelLeft, MoreHorizontal, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { pricePrecision, qtyPrecision, type SymbolSpec } from '../../config/symbols';
import type { TimeInForce } from '../../engine/types';
import { fmtMoney, fmtNumber, fmtPrice, fmtQty, fmtShortDate } from '../../lib/format';
import type { ExitKind, ExitUnit, OrderType, QtyUnit } from '../../lib/orderMath';
import { useTicketStore, type OrderTicket } from '../../order-ticket/ticketStore';
import type { TicketView } from '../../order-ticket/types';
import { useUiStore } from '../../store/uiStore';
import { MenuItem, Popover } from '../../ui/Popover';
import { Checkbox, Switch } from '../../ui/Switch';
import { SymbolLogo } from '../../ui/SymbolLogo';
import styles from './CurrentOrderPanel.module.css';
import { LabelDropdown, NumberField, SlotDropdown, type Option } from './fields';

/**
 * Control variant: a copy of the production Paper Trading order ticket, including its quirks
 * (price does not follow side/type switches, Buy Limit above Ask executes silently).
 */
export function CurrentOrderPanel({ ticket }: { ticket: OrderTicket }) {
  const { state, view, spec } = ticket;
  const t = useTicketStore.getState();
  const [tab, setTab] = useState<'order' | 'dom'>('order');
  const [exitsOpen, setExitsOpen] = useState(true);
  const [extraOpen, setExtraOpen] = useState(true);

  // Keep the price filled once quotes arrive.
  useEffect(() => {
    if (state.type !== 'market' && state.priceInput === '' && view.ready) t.ensurePrice();
  }, [state.type, state.priceInput, view.ready, t]);

  return (
    <div className={styles.panel} data-testid="order-panel" data-variant="current">
      <Header spec={spec} />
      <div className={styles.segmented} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'order'}
          className={`${styles.segment} ${tab === 'order' ? styles.segmentActive : ''}`}
          onClick={() => setTab('order')}
        >
          Order
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'dom'}
          className={`${styles.segment} ${tab === 'dom' ? styles.segmentActive : ''}`}
          onClick={() => setTab('dom')}
        >
          DOM
        </button>
      </div>

      {tab === 'dom' ? (
        <div className={styles.domStub}>Depth of Market is not available in this prototype.</div>
      ) : (
        <>
          <SideSelector ticket={ticket} />
          <TypeTabs type={state.type} onChange={t.setType} />
          <div className={styles.scroll}>
            <div className={styles.content}>
              {state.type !== 'market' && <PriceBlock ticket={ticket} />}
              <QuantityBlock ticket={ticket} />

              <SectionHeader title="Exits" open={exitsOpen} onToggle={() => setExitsOpen((v) => !v)} />
              {exitsOpen && (
                <>
                  <ExitBlock kind="tp" ticket={ticket} />
                  <ExitBlock kind="sl" ticket={ticket} />
                  {view.riskReward !== null && (
                    <div className={styles.infoRow}>
                      <span className={styles.infoLabel}>Risk / Reward</span>
                      <span className="tabular">{fmtNumber(view.riskReward, 2).replace(/\.?0+$/, '')}</span>
                    </div>
                  )}
                  {state.sl.enabled && state.tp.enabled && (
                    <button type="button" className={styles.addLevel} title="Multiple exit levels are not available in this prototype">
                      <Plus size={16} /> Add level
                    </button>
                  )}
                </>
              )}

              <SectionHeader spaced title="Extra settings" open={extraOpen} onToggle={() => setExtraOpen((v) => !v)} />
              {extraOpen && <ExtraSettings ticket={ticket} />}
            </div>
          </div>
          <SubmitButton ticket={ticket} />
        </>
      )}
    </div>
  );
}

function Header({ spec }: { spec: SymbolSpec }) {
  const closeTicket = useUiStore((s) => s.closeTicket);
  const [menu, setMenu] = useState(false);
  const [slRisk, setSlRisk] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className={styles.header}>
      <div className={styles.headerTitle}>
        <SymbolLogo symbol={spec.symbol} size={24} />
        <span className={styles.headerSymbol}>{spec.symbol}</span>
      </div>
      <button type="button" className={styles.headerBtn} aria-label="Layout" title="Layout">
        <LayoutPanelLeft size={20} strokeWidth={1.4} />
      </button>
      <button ref={ref} type="button" className={styles.headerBtn} aria-label="More" onClick={() => setMenu((v) => !v)}>
        <MoreHorizontal size={20} strokeWidth={1.4} />
      </button>
      <Popover anchor={ref} open={menu} onClose={() => setMenu(false)} align="end">
        <MenuItem disabled onSelect={() => {}}>
          Undock order ticket
        </MenuItem>
        <MenuItem disabled onSelect={() => {}}>
          Trading settings…
        </MenuItem>
        <div style={{ padding: '6px 10px' }}>
          <Checkbox checked={slRisk} onChange={setSlRisk} label="SL enables quantity in risk" />
        </div>
      </Popover>
      <button type="button" className={styles.headerBtn} aria-label="Close order panel" onClick={closeTicket} data-testid="close-ticket">
        <X size={20} strokeWidth={1.4} />
      </button>
    </div>
  );
}

function SideSelector({ ticket }: { ticket: OrderTicket }) {
  const { state, view, spec } = ticket;
  const setSide = useTicketStore((s) => s.setSide);
  return (
    <div className={styles.sideWrap}>
      <div className={styles.side}>
        <button
          type="button"
          className={`${styles.sideBtn} ${styles.sell} ${state.side === 'sell' ? styles.sellActive : ''}`}
          onClick={() => setSide('sell')}
          aria-pressed={state.side === 'sell'}
          data-testid="side-sell"
        >
          <span className={styles.sideTitle}>Sell</span>
          <span className={`${styles.sideValue} tabular`}>{view.ready ? fmtPrice(view.bid, spec) : '—'}</span>
        </button>
        <button
          type="button"
          className={`${styles.sideBtn} ${styles.buy} ${state.side === 'buy' ? styles.buyActive : ''}`}
          onClick={() => setSide('buy')}
          aria-pressed={state.side === 'buy'}
          data-testid="side-buy"
        >
          <span className={styles.sideTitle}>Buy</span>
          <span className={`${styles.sideValue} tabular`}>{view.ready ? fmtPrice(view.ask, spec) : '—'}</span>
        </button>
        <span className={`${styles.spread} tabular`}>{view.ready ? fmtNumber(view.spread, pricePrecision(spec), { grouping: false }) : ''}</span>
      </div>
    </div>
  );
}

const TYPES: { id: OrderType; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop', label: 'Stop' },
];

function TypeTabs({ type, onChange }: { type: OrderType; onChange: (t: OrderType) => void }) {
  return (
    <div className={styles.typeTabs} role="tablist">
      {TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={type === t.id}
          className={`${styles.typeTab} ${type === t.id ? styles.typeTabActive : ''}`}
          onClick={() => onChange(t.id)}
          data-testid={`type-${t.id}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PriceBlock({ ticket }: { ticket: OrderTicket }) {
  const { state, view, spec } = ticket;
  const setPriceInput = useTicketStore((s) => s.setPriceInput);
  const p = view.price;
  let hint = '';
  if (p && p.offsetTicks !== null) {
    hint = p.offsetTicks === 0 ? p.ref : `${p.ref} ${p.offsetTicks > 0 ? '+' : '−'} ${Math.abs(p.offsetTicks)}`;
  }
  return (
    <div className={styles.block}>
      <div className={styles.labelRow}>
        <span className={styles.label}>Price</span>
      </div>
      <NumberField
        ariaLabel="Price"
        value={state.priceInput}
        onChange={setPriceInput}
        step={spec.tickSize}
        decimals={pricePrecision(spec)}
        invalid={!!p?.invalid}
        error="Selected price isn't valid for this order type"
        right={<span className={styles.hint}>{hint}</span>}
        testId="price-input"
      />
    </div>
  );
}

function qtyUnitLabel(unit: QtyUnit, spec: SymbolSpec): string {
  switch (unit) {
    case 'units':
      return spec.qtyLabel;
    case 'value':
      return 'USD';
    case 'balancePercent':
      return '% balance';
    case 'riskMoney':
      return 'Risk USD';
    case 'riskBalancePercent':
      return 'Risk % balance';
  }
}

function qtyEquivalentText(unit: QtyUnit, view: TicketView, spec: SymbolSpec): { value: string; unit: string } {
  const eq = view.qty.equivalents;
  switch (unit) {
    case 'units':
      return { value: fmtQty(eq.units, spec), unit: spec.qtyLabel.toLowerCase() };
    case 'value':
      return { value: fmtNumber(eq.value, 2, { grouping: false }), unit: 'USD' };
    case 'balancePercent':
      return { value: fmtNumber(eq.balancePercent, 2), unit: '%' };
    case 'riskMoney':
      return { value: eq.riskMoney === null ? '∅' : fmtNumber(eq.riskMoney, 2, { grouping: false }), unit: eq.riskMoney === null ? '' : 'USD' };
    case 'riskBalancePercent':
      return { value: eq.riskBalancePercent === null ? '∅' : fmtNumber(eq.riskBalancePercent, 2), unit: eq.riskBalancePercent === null ? '' : '%' };
  }
}

const QTY_UNITS: QtyUnit[] = ['units', 'value', 'balancePercent', 'riskMoney', 'riskBalancePercent'];

function QuantityBlock({ ticket }: { ticket: OrderTicket }) {
  const { state, view, spec } = ticket;
  const t = useTicketStore.getState();
  // Right slot shows the quantity in another unit: USD for shares, shares for everything else.
  const [alt, setAlt] = useState<QtyUnit>('value');
  const altUnit: QtyUnit = alt === state.qtyUnit ? (state.qtyUnit === 'units' ? 'value' : 'units') : alt;
  const altText = qtyEquivalentText(altUnit, view, spec);
  const inputDecimals = state.qtyUnit === 'units' ? qtyPrecision(spec) : 2;
  return (
    <div className={styles.block}>
      <div className={styles.labelRow}>
        <LabelDropdown
          label={qtyUnitLabel(state.qtyUnit, spec)}
          value={state.qtyUnit}
          options={QTY_UNITS.map((u) => ({ value: u, label: qtyUnitLabel(u, spec) }))}
          onChange={(u) => t.setQtyUnit(u, view)}
          testId="qty-unit"
        />
      </div>
      <NumberField
        ariaLabel="Quantity"
        value={state.qtyInput}
        onChange={t.setQtyInput}
        step={state.qtyUnit === 'units' ? spec.qtyStep : 1}
        decimals={inputDecimals}
        right={
          <SlotDropdown
            value={altText.value}
            unit={altText.unit}
            current={altUnit}
            onChange={setAlt}
            options={QTY_UNITS.filter((u) => u !== state.qtyUnit).map((u) => {
              const e = qtyEquivalentText(u, view, spec);
              return { value: u, label: qtyUnitLabel(u, spec), end: `${e.value} ${e.unit}`.trim() };
            })}
          />
        }
        testId="qty-input"
      />
      {view.qty.needsStopLoss && <div className={styles.fieldNote}>Turn on stop loss to calculate quantity</div>}
      <div className={styles.infoRow}>
        <span className={styles.infoLabel}>Tick value</span>
        <span>
          <span className="tabular">{fmtNumber(view.qty.tickValue, 2)}</span>
          <span className={styles.ccy}>USD</span>
        </span>
      </div>
    </div>
  );
}

function exitUnitLabel(kind: ExitKind, unit: ExitUnit): string {
  switch (unit) {
    case 'price':
      return 'price';
    case 'ticks':
      return 'ticks';
    case 'percent':
      return '% price';
    case 'money':
      return kind === 'tp' ? 'Reward USD' : 'Risk USD';
    case 'balancePercent':
      return kind === 'tp' ? 'Reward % balance' : 'Risk % balance';
  }
}

const EXIT_UNITS: ExitUnit[] = ['price', 'ticks', 'percent', 'money', 'balancePercent'];

type AltExit = 'price' | 'ticks' | 'money';

function exitAltText(alt: AltExit, view: TicketView, kind: ExitKind, spec: SymbolSpec): { value: string; unit: string } {
  const lvl = view[kind].level;
  if (!lvl) return { value: '', unit: '' };
  if (alt === 'price') return { value: fmtPrice(lvl.price, spec, { grouping: false }), unit: '' };
  if (alt === 'ticks') return { value: String(lvl.ticks), unit: 'ticks' };
  return { value: fmtMoney(Math.abs(lvl.money)), unit: 'USD' };
}

function ExitBlock({ kind, ticket }: { kind: ExitKind; ticket: OrderTicket }) {
  const { view, spec } = ticket;
  const t = useTicketStore.getState();
  const ex = view[kind];
  const defaultAlt: AltExit = ex.unit === 'price' ? 'ticks' : ex.unit === 'ticks' ? 'money' : 'price';
  const [altPick, setAltPick] = useState<AltExit | null>(null);
  const alt = altPick && !(altPick === 'price' && ex.unit === 'price') && !(altPick === 'ticks' && ex.unit === 'ticks') ? altPick : defaultAlt;
  const altText = exitAltText(alt, view, kind, spec);
  const title = kind === 'tp' ? 'Take profit' : 'Stop loss';
  const decimals = ex.unit === 'price' ? pricePrecision(spec) : ex.unit === 'ticks' ? 0 : 2;
  const step = ex.unit === 'price' ? spec.tickSize : 1;
  const altOptions: Option<AltExit>[] = (['price', 'ticks', 'money'] as AltExit[])
    .filter((a) => !(a === 'price' && ex.unit === 'price') && !(a === 'ticks' && ex.unit === 'ticks'))
    .map((a) => {
      const e = exitAltText(a, view, kind, spec);
      return { value: a, label: a === 'money' ? 'USD' : a === 'price' ? 'Price' : 'Ticks', end: `${e.value} ${e.unit}`.trim() };
    });
  return (
    <div className={`${styles.block} ${styles.exitBlock}`}>
      <div className={`${styles.labelRow} ${styles.labelRowSwitch}`}>
        <LabelDropdown
          label={`${title} ${exitUnitLabel(kind, ex.unit)}`}
          value={ex.unit}
          options={EXIT_UNITS.map((u) => ({ value: u, label: exitUnitLabel(kind, u).replace(/^./, (c) => c.toUpperCase()) }))}
          onChange={(u) => t.setExitUnit(kind, u, view)}
          testId={`${kind}-unit`}
        />
        <Switch checked={ex.enabled} onChange={(v) => t.setExitEnabled(kind, v)} label={title} testId={`${kind}-toggle`} />
      </div>
      <NumberField
        ariaLabel={title}
        value={ex.input}
        onChange={(v) => t.setExitInput(kind, v)}
        step={step}
        decimals={decimals}
        disabled={!ex.enabled}
        onActivate={() => t.setExitEnabled(kind, true)}
        invalid={ex.enabled && !!ex.error}
        error={ex.error}
        right={<SlotDropdown value={altText.value} unit={altText.unit} current={alt} onChange={setAltPick} disabled={!ex.enabled} options={altOptions} />}
        testId={`${kind}-input`}
      />
    </div>
  );
}

function SectionHeader({ title, open, onToggle, spaced }: { title: string; open: boolean; onToggle: () => void; spaced?: boolean }) {
  return (
    <button type="button" className={`${styles.sectionHeader} ${spaced ? styles.sectionGap : ''}`} onClick={onToggle} aria-expanded={open}>
      <span>{title}</span>
      {open ? <ChevronUp size={18} strokeWidth={1.5} /> : <ChevronDown size={18} strokeWidth={1.5} />}
    </button>
  );
}

const TIFS: { id: TimeInForce; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'gtd', label: 'GTD' },
];

function ExtraSettings({ ticket }: { ticket: OrderTicket }) {
  const { state, view } = ticket;
  const t = useTicketStore.getState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return (
    <div className={styles.extra}>
      <div className={styles.block}>
        <div className={styles.labelRow}>
          <span className={styles.label}>Time in force</span>
        </div>
        <button ref={ref} type="button" className={styles.select} onClick={() => setOpen((v) => !v)} data-testid="tif-select">
          <span>{TIFS.find((x) => x.id === state.tif)?.label}</span>
          {view.expiresAt && state.type !== 'market' && <span className={styles.selectHint}>till {fmtShortDate(view.expiresAt)}</span>}
          <ChevronDown size={18} strokeWidth={1.5} />
        </button>
        <Popover anchor={ref} open={open} onClose={() => setOpen(false)} matchWidth>
          {TIFS.map((x) => (
            <MenuItem key={x.id} active={x.id === state.tif} onSelect={() => (t.setTif(x.id), setOpen(false))}>
              {x.label}
            </MenuItem>
          ))}
        </Popover>
        {state.tif === 'gtd' && (
          <input
            type="date"
            className={styles.dateInput}
            min={minDate}
            value={state.gtdDate}
            onChange={(e) => t.setGtdDate(e.target.value)}
            aria-label="Good till date"
          />
        )}
      </div>
      <div className={styles.checkRow}>
        <Checkbox checked={state.fillOutsideRth} onChange={t.setFillOutsideRth} label="Fill order outside RTH" />
        <CircleHelp size={16} className={styles.help} />
      </div>
      <div className={styles.checkRow}>
        <Checkbox checked={false} onChange={() => {}} disabled={!state.tp.enabled} label="Fill take profit outside RTH" />
        <CircleHelp size={16} className={styles.help} />
      </div>
    </div>
  );
}

function SubmitButton({ ticket }: { ticket: OrderTicket }) {
  const { state, view, spec } = ticket;
  const submit = useTicketStore((s) => s.submit);
  const qty = fmtQty(view.qty.units, spec);
  const typeWord = state.type === 'market' ? 'MARKET' : state.type === 'limit' ? 'LIMIT' : 'STOP';
  const priceText = state.type !== 'market' && view.price?.value != null ? ` @ ${fmtPrice(view.price.value, spec, { grouping: false })}` : '';
  const secondary = `${qty} ${spec.symbol}${priceText} ${typeWord}`;
  return (
    <div className={styles.submitWrap}>
      <button
        type="button"
        className={`${styles.submit} ${state.side === 'buy' ? styles.submitBuy : styles.submitSell}`}
        disabled={!view.canSubmit}
        title={view.disabledText ?? undefined}
        onClick={() => submit(view)}
        data-testid="submit-order"
      >
        <span className={styles.submitPrimary}>{state.side === 'buy' ? 'Buy' : 'Sell'}</span>
        <span className={styles.submitSecondary}>{secondary}</span>
      </button>
    </div>
  );
}
