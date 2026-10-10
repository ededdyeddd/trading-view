import { useState, type ReactNode } from 'react';
import { OrderPanelHost } from '..';
import type { ExitUnit, OrderType, QtyUnit, Side } from '../../lib/orderMath';
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
  Switch,
  TextButton,
  UnderlineTabs,
  ValueField,
  type MenuOption,
} from './ui/atoms';
import styles from './Sandbox.module.css';

const TYPES: { id: OrderType; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop', label: 'Stop' },
];

const QTY_UNITS: MenuOption<QtyUnit>[] = [
  { value: 'units', label: 'Shares', end: '100 shares' },
  { value: 'value', label: 'USD', end: '20,157.00 USD' },
  { value: 'balancePercent', label: '% balance', end: '20.17 %' },
  { value: 'riskMoney', label: 'Risk USD', disabled: true },
  { value: 'riskBalancePercent', label: 'Risk % balance', disabled: true },
];

const SL_UNITS: MenuOption<ExitUnit>[] = [
  { value: 'price', label: 'Price', end: '197.50' },
  { value: 'ticks', label: 'Ticks', end: '407 ticks' },
  { value: 'percent', label: '% price', end: '2.02 %' },
  { value: 'money', label: 'Risk USD', end: '407.00 USD' },
  { value: 'balancePercent', label: 'Risk % balance', end: '0.41 %' },
];

function Cell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.cell}>
      <div className={styles.cellTitle}>{title}</div>
      <div className={styles.cellBody}>{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h2>{title}</h2>
      <div className={styles.grid}>{children}</div>
    </section>
  );
}

const noop = () => {};

/** Atom gallery for the redesigned ticket — every state side by side (?sandbox=1). */
export function Sandbox() {
  const [side, setSide] = useState<Side>('buy');
  const [type, setType] = useState<OrderType>('market');
  const [seg, setSeg] = useState<'order' | 'dom'>('order');
  const [unit, setUnit] = useState<QtyUnit>('units');
  const [qty, setQty] = useState('100');
  const [on, setOn] = useState(true);
  const [tick, setTick] = useState(0);
  const bid = (201.56 + tick * 0.01).toFixed(2);
  const ask = (201.57 + tick * 0.01).toFixed(2);

  return (
    <div className={styles.page}>
      <h1>Order panel `new` — atoms</h1>

      <Group title="SegmentedControl">
        <Cell title="Order active">
          <SegmentedControl
            items={[
              { id: 'order', label: 'Order' },
              { id: 'dom', label: 'DOM' },
            ]}
            value={seg}
            onChange={setSeg}
          />
        </Cell>
      </Group>

      <Group title="SideToggle">
        <Cell title="buy">
          <SideToggle side="buy" bid="201.56" ask="201.57" spread="0.01" onChange={noop} />
        </Cell>
        <Cell title="sell">
          <SideToggle side="sell" bid="201.56" ask="201.57" spread="0.01" onChange={noop} />
        </Cell>
        <Cell title="interactive + price tick">
          <SideToggle side={side} bid={bid} ask={ask} spread="0.01" onChange={setSide} />
          <button type="button" className={styles.link} onClick={() => setTick((t) => t + 1)}>
            tick +0.01
          </button>
        </Cell>
      </Group>

      <Group title="UnderlineTabs">
        <Cell title="active (Market) · hover others">
          <UnderlineTabs items={TYPES} value={type} onChange={setType} />
        </Cell>
      </Group>

      <Group title="FieldLabelMenu">
        <Cell title="closed">
          <FieldLabelMenu label="Shares" value={unit} options={QTY_UNITS} onChange={setUnit} />
        </Cell>
        <Cell title="open (live values, Risk inactive)">
          <div style={{ minHeight: 210 }}>
            <FieldLabelMenu label="Shares" value={unit} options={QTY_UNITS} onChange={setUnit} forceOpen />
          </div>
        </Cell>
      </Group>

      <Group title="ValueField + FieldCaption">
        <Cell title="empty">
          <ValueField value="" onChange={noop} placeholder="0" right="0.00 USD" ariaLabel="q" />
          <FieldCaption>Available margin 99,953.90 USD</FieldCaption>
        </Cell>
        <Cell title="filled (editable)">
          <ValueField value={qty} onChange={setQty} placeholder="0" right="20,157.00 USD" ariaLabel="q" />
          <FieldCaption>Margin 403.14 USD · Tick 1.00 USD</FieldCaption>
        </Cell>
        <Cell title="focus">
          <ValueField value="100" onChange={noop} placeholder="0" right="20,157.00 USD" ariaLabel="q" forceFocus />
        </Cell>
        <Cell title="formatted (unit in the label)">
          <ValueField value="20000" display="20,000.00" onChange={noop} placeholder="0" right="99 shares" ariaLabel="q" />
          <FieldCaption>Margin 399.11 USD · Tick 0.99 USD</FieldCaption>
        </Cell>
        <Cell title="disabled">
          <ValueField value="" onChange={noop} placeholder="Enter price" placeholderStyle="text" disabled ariaLabel="q" />
        </Cell>
        <Cell title="error">
          <ValueField value="205.00" onChange={noop} placeholder="Enter price" state="error" ariaLabel="q" />
          <FieldCaption tone="error">Stop loss must be below entry</FieldCaption>
        </Cell>
        <Cell title="warning">
          <ValueField value="201.64" onChange={noop} placeholder="Enter price" state="warning" right="Ask + 0.07" ariaLabel="q" />
          <FieldCaption tone="warning">Fills now: price is above Ask</FieldCaption>
        </Cell>
      </Group>

      <Group title="ExitLevel">
        <Cell title="off">
          <ExitLevel
            label="Stop loss price"
            unit={'price' as ExitUnit}
            units={SL_UNITS}
            onUnit={noop}
            enabled={false}
            onToggle={noop}
            title="Stop loss"
            field={{ value: '', onChange: noop, placeholder: 'Enter price', ariaLabel: 'sl' }}
            caption={null}
            captionTone="neutral"
            testId="sb-off"
          />
        </Cell>
        <Cell title="on (toggle me)">
          <ExitLevel
            label="Stop loss price"
            unit={'price' as ExitUnit}
            units={SL_UNITS}
            onUnit={noop}
            enabled={on}
            onToggle={setOn}
            title="Stop loss"
            field={{
              value: on ? '197.50' : '',
              onChange: noop,
              placeholder: 'Enter price',
              right: on ? '−407.00 USD' : undefined,
              rightTone: 'danger',
              ariaLabel: 'sl',
            }}
            caption="−4.07 (−2.02%) from entry"
            captionTone="neutral"
            testId="sb-on"
          />
        </Cell>
        <Cell title="error">
          <ExitLevel
            label="Stop loss price"
            unit={'price' as ExitUnit}
            units={SL_UNITS}
            onUnit={noop}
            enabled
            onToggle={noop}
            title="Stop loss"
            field={{ value: '205.00', onChange: noop, placeholder: 'Enter price', state: 'error', ariaLabel: 'sl' }}
            caption="Stop loss must be below entry"
            captionTone="error"
            testId="sb-err"
          />
        </Cell>
        <Cell title="take profit on, ticks">
          <ExitLevel
            label="Take profit ticks"
            unit={'ticks' as ExitUnit}
            units={SL_UNITS}
            onUnit={noop}
            enabled
            onToggle={noop}
            title="Take profit"
            field={{ value: '943', onChange: noop, placeholder: 'Enter ticks', right: '+943.00 USD', rightTone: 'success', ariaLabel: 'tp' }}
            caption="At 211.00 · +4.68% from entry"
            captionTone="neutral"
            testId="sb-tp"
          />
        </Cell>
      </Group>

      <Group title="InfoRow · SettingsRow · TextButton · Switch">
        <Cell title="InfoRow">
          <InfoRow label="Risk / Reward" value="1 : 2.32" />
        </Cell>
        <Cell title="SettingsRow">
          <SettingsRow title="Time in force" value="Week · Oct 16" chevron="right" />
          <div style={{ height: 20 }} />
          <SettingsRow title="Extra settings" chevron="down" onClick={noop} />
          <div style={{ height: 20 }} />
          <SettingsRow title="Exits" chevron="up" onClick={noop} />
        </Cell>
        <Cell title="TextButton (hover → Coming soon)">
          <div style={{ paddingTop: 24 }}>
            <TextButton tooltip="Coming soon">Add partial exit</TextButton>
          </div>
        </Cell>
        <Cell title="Switch">
          <Switch checked={false} onChange={noop} label="off" /> <Switch checked onChange={noop} label="on" />
        </Cell>
      </Group>

      <Group title="OrderSummary + SubmitButton">
        <Cell title="hidden · enabled">
          <OrderSummary parts={null}>
            <SubmitButton side="buy" primary="Buy" secondary="100 AAPL · MKT" onClick={noop} />
          </OrderSummary>
        </Cell>
        <Cell title="disabled with reason">
          <OrderSummary parts={null}>
            <SubmitButton side="buy" primary="Buy" secondary="Enter quantity to buy AAPL" disabled onClick={noop} />
          </OrderSummary>
        </Cell>
        <Cell title="one exit">
          <OrderSummary parts={[{ label: 'SL', amount: '−407.00 USD' }]}>
            <SubmitButton side="buy" primary="Buy" secondary="100 AAPL · MKT" onClick={noop} />
          </OrderSummary>
        </Cell>
        <Cell title="two exits">
          <OrderSummary parts={[{ label: 'SL', amount: '−407.00 USD' }, { label: 'TP', amount: '+943.00 USD' }]}>
            <SubmitButton side="buy" primary="Buy" secondary="100 AAPL · MKT" onClick={noop} />
          </OrderSummary>
        </Cell>
        <Cell title="sell">
          <OrderSummary parts={[{ label: 'SL', amount: '−407.00 USD' }, { label: 'TP', amount: '+943.00 USD' }]}>
            <SubmitButton side="sell" primary="Sell" secondary="100 AAPL · MKT" onClick={noop} />
          </OrderSummary>
        </Cell>
        <Cell title="sell disabled">
          <SubmitButton side="sell" primary="Sell" secondary="Stop loss must be above entry" disabled onClick={noop} />
        </Cell>
        <Cell title="loading">
          <SubmitButton side="buy" primary="Buy" secondary="100 AAPL · MKT" loading onClick={noop} />
        </Cell>
      </Group>
    </div>
  );
}

/** The panel alone at the Figma frame size (320 × 762) for 1:1 screenshot comparison (?sandbox=panel&panel=new&freeze=1). */
export function PanelSandbox() {
  return (
    <div style={{ padding: 0, background: 'var(--color-bg-app)', height: '100vh' }}>
      <div style={{ width: 320, height: Number(new URLSearchParams(location.search).get('h')) || 762, background: 'var(--nt-bg)' }} data-testid="panel-frame">
        <OrderPanelHost />
      </div>
    </div>
  );
}
