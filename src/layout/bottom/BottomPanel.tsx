import { ChevronDown, ChevronUp, Maximize2, Minimize2, Pencil, RotateCcw, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { getSpec } from '../../config/symbols';
import { unrealizedPnl } from '../../engine/paperEngine';
import type { Order } from '../../engine/types';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPercent, fmtPrice, fmtQty, parseNum } from '../../lib/format';
import { marginFor, tradeValue } from '../../lib/orderMath';
import { useMarketStore } from '../../market/marketStore';
import { useAccountSummary, useTradingStore } from '../../store/tradingStore';
import { useUiStore, type BottomTab } from '../../store/uiStore';
import { Popover } from '../../ui/Popover';
import styles from './BottomPanel.module.css';

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Orders' },
  { id: 'history', label: 'History' },
  { id: 'summary', label: 'Account Summary' },
  { id: 'log', label: 'Notifications log' },
];

export function BottomPanel() {
  const collapsed = useUiStore((s) => s.bottomCollapsed);
  const setCollapsed = useUiStore((s) => s.setBottomCollapsed);
  const height = useUiStore((s) => s.bottomHeight);
  const setHeight = useUiStore((s) => s.setBottomHeight);
  const tab = useUiStore((s) => s.bottomTab);
  const setTab = useUiStore((s) => s.setBottomTab);
  const openTicket = useUiStore((s) => s.openTicket);
  const engine = useTradingStore((s) => s.engine);
  const positionsCount = Object.keys(engine.positions).length;
  const ordersCount = engine.orders.filter((o) => o.status === 'working').length;

  return (
    <div className={styles.panel} data-testid="bottom-panel">
      <div className={styles.header}>
        <button type="button" className={styles.brokerTab} onClick={() => setCollapsed(!collapsed)}>
          <span className={styles.brokerDot} />
          Paper Trading
          {collapsed ? <ChevronUp size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
        </button>
        <span className={styles.spacer} />
        <button type="button" className={styles.tradeBtn} onClick={() => openTicket('bottom-panel')} data-testid="bottom-trade">
          Trade
        </button>
        <button type="button" className={styles.iconBtn} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'} onClick={() => setCollapsed(!collapsed)}>
          <Minimize2 size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Maximize panel"
          onClick={() => {
            setCollapsed(false);
            setHeight(height >= 600 ? 300 : 640);
          }}
        >
          <Maximize2 size={16} strokeWidth={1.5} />
        </button>
      </div>
      {!collapsed && (
        <div className={styles.body}>
          <AccountHeader />
          <div className={styles.tabs} role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
                onClick={() => setTab(t.id)}
                data-testid={`tab-${t.id}`}
              >
                {t.label}
                {t.id === 'positions' && positionsCount > 0 && <span className={styles.count}>{positionsCount}</span>}
                {t.id === 'orders' && ordersCount > 0 && <span className={styles.count}>{ordersCount}</span>}
              </button>
            ))}
          </div>
          <div className={styles.content}>
            {tab === 'positions' && <PositionsTable />}
            {tab === 'orders' && <OrdersTable />}
            {tab === 'history' && <HistoryTable />}
            {tab === 'summary' && <AccountSummaryView />}
            {tab === 'log' && <NotificationsLog />}
          </div>
        </div>
      )}
    </div>
  );
}

function pnlClass(n: number) {
  return n > 0 ? styles.pos : n < 0 ? styles.neg : '';
}

function AccountHeader() {
  const sum = useAccountSummary();
  const items: [string, number, boolean?][] = [
    ['Account balance', sum.balance],
    ['Equity', sum.equity],
    ['Realized P&L', sum.realizedPnl, true],
    ['Unrealized P&L', sum.unrealizedPnl, true],
    ['Account margin', sum.accountMargin],
    ['Available funds', sum.availableFunds],
    ['Orders margin', sum.ordersMargin],
  ];
  return (
    <div className={styles.account}>
      <span className={styles.accountSelect}>
        Paper Trading <small>USD</small> <ChevronDown size={14} />
      </span>
      <div className={styles.metrics}>
        {items.map(([label, value, colored]) => (
          <div key={label} className={styles.metric} data-testid={`metric-${label}`}>
            <span className={styles.metricLabel}>{label}</span>
            <span className={`${styles.metricValue} tabular ${colored ? pnlClass(value) : ''}`}>{fmtMoney(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode[]; empty: string }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {children.length === 0 && <div className={styles.empty}>{empty}</div>}
    </div>
  );
}

function SymbolCell({ symbol }: { symbol: string }) {
  const setSymbol = useUiStore((s) => s.setSymbol);
  return (
    <button type="button" className={styles.symbolLink} onClick={() => setSymbol(symbol)}>
      {symbol}
    </button>
  );
}

function SideCell({ side }: { side: 'buy' | 'sell' }) {
  return <span className={side === 'buy' ? styles.buy : styles.sell}>{side === 'buy' ? 'Buy' : 'Sell'}</span>;
}

function PositionsTable() {
  const engine = useTradingStore((s) => s.engine);
  const quotes = useMarketStore((s) => s.quotes);
  const closePosition = useTradingStore((s) => s.closePosition);
  const positions = Object.values(engine.positions);
  return (
    <Table
      head={[
        'Symbol',
        'Side',
        'Quantity',
        'Avg fill price',
        'Take profit',
        'Stop loss',
        'Last price',
        'Unrealized P&L',
        'Unrealized P&L %',
        'Trade value',
        'Margin',
        '',
      ]}
      empty="There are no open positions in your trading account yet"
    >
      {positions.map((p) => {
        const spec = getSpec(p.symbol);
        const q = quotes[p.symbol];
        const upnl = unrealizedPnl(p, q);
        const cost = tradeValue(Math.abs(p.qty), p.avgPrice, spec);
        const legs = engine.orders.filter((o) => o.symbol === p.symbol && o.status === 'working' && o.role !== 'entry');
        const tp = legs.find((o) => o.role === 'tp')?.limitPrice;
        const sl = legs.find((o) => o.role === 'sl')?.stopPrice;
        const last = q ? (p.qty > 0 ? q.bid : q.ask) : p.avgPrice;
        return (
          <tr key={p.symbol} data-testid={`position-${p.symbol}`}>
            <td>
              <SymbolCell symbol={p.symbol} />
            </td>
            <td>
              <SideCell side={p.qty > 0 ? 'buy' : 'sell'} />
            </td>
            <td className="tabular">{fmtQty(Math.abs(p.qty), spec)}</td>
            <td className="tabular">{fmtPrice(p.avgPrice, spec)}</td>
            <td className="tabular">{tp !== undefined ? fmtPrice(tp, spec) : ''}</td>
            <td className="tabular">{sl !== undefined ? fmtPrice(sl, spec) : ''}</td>
            <td className="tabular">{fmtPrice(last, spec)}</td>
            <td className={`tabular ${pnlClass(upnl)}`}>{fmtMoney(upnl)}</td>
            <td className={`tabular ${pnlClass(upnl)}`}>{fmtPercent(cost ? (upnl / cost) * 100 : 0)}</td>
            <td className="tabular">{fmtMoney(tradeValue(Math.abs(p.qty), last, spec))}</td>
            <td className="tabular">{fmtMoney(marginFor(Math.abs(p.qty), last, spec))}</td>
            <td className={styles.actions}>
              <button
                type="button"
                className={styles.rowBtn}
                title="Close position"
                aria-label="Close position"
                onClick={() => closePosition(p.symbol)}
                data-testid={`close-${p.symbol}`}
              >
                <X size={16} />
              </button>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

function typeText(o: Order) {
  if (o.role === 'tp') return 'Take profit';
  if (o.role === 'sl') return 'Stop loss';
  return o.type === 'market' ? 'Market' : o.type === 'limit' ? 'Limit' : 'Stop';
}

const STATUS_CLASS: Record<string, string> = {
  filled: styles.pos,
  cancelled: styles.muted,
  expired: styles.warn,
  rejected: styles.neg,
  working: '',
};

function OrdersTable() {
  const orders = useTradingStore((s) => s.engine.orders).filter((o) => o.status === 'working');
  const cancelOrder = useTradingStore((s) => s.cancelOrder);
  return (
    <Table
      head={['Symbol', 'Side', 'Type', 'Quantity', 'Limit price', 'Stop price', 'Take profit', 'Stop loss', 'Status', 'Placing time', 'Expiry', 'Order ID', '']}
      empty="There are no working orders"
    >
      {orders
        .slice()
        .reverse()
        .map((o) => {
          const spec = getSpec(o.symbol);
          return (
            <tr key={o.id} data-testid={`order-${o.id}`}>
              <td>
                <SymbolCell symbol={o.symbol} />
              </td>
              <td>
                <SideCell side={o.side} />
              </td>
              <td>{typeText(o)}</td>
              <td className="tabular">{fmtQty(o.qty, spec)}</td>
              <td className="tabular">{o.limitPrice !== undefined ? fmtPrice(o.limitPrice, spec) : ''}</td>
              <td className="tabular">{o.stopPrice !== undefined ? fmtPrice(o.stopPrice, spec) : ''}</td>
              <td className="tabular">{o.takeProfit !== undefined ? fmtPrice(o.takeProfit, spec) : ''}</td>
              <td className="tabular">{o.stopLoss !== undefined ? fmtPrice(o.stopLoss, spec) : ''}</td>
              <td>Working</td>
              <td className="tabular">{fmtDateTime(o.createdAt)}</td>
              <td className="tabular">{o.expiresAt ? fmtDateTime(o.expiresAt) : 'GTC'}</td>
              <td className="tabular">{o.id}</td>
              <td className={styles.actions}>
                <ModifyButton order={o} />
                <button
                  type="button"
                  className={styles.rowBtn}
                  title="Cancel order"
                  aria-label="Cancel order"
                  onClick={() => cancelOrder(o.id)}
                  data-testid={`cancel-${o.id}`}
                >
                  <X size={16} />
                </button>
              </td>
            </tr>
          );
        })}
    </Table>
  );
}

function ModifyButton({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const spec = getSpec(order.symbol);
  const modifyOrder = useTradingStore((s) => s.modifyOrder);
  const priceKey = order.type === 'limit' ? 'limitPrice' : 'stopPrice';
  const [qty, setQty] = useState(String(order.qty));
  const [price, setPrice] = useState(String(order[priceKey] ?? ''));
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.rowBtn}
        title="Modify order"
        aria-label="Modify order"
        onClick={() => {
          setQty(String(order.qty));
          setPrice(String(order[priceKey] ?? ''));
          setOpen((v) => !v);
        }}
        data-testid={`modify-${order.id}`}
      >
        <Pencil size={14} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end">
        <form
          className={styles.modify}
          onSubmit={(e) => {
            e.preventDefault();
            const patch: Record<string, number> = { qty: parseNum(qty) };
            if (order.type !== 'market') patch[priceKey] = parseNum(price);
            modifyOrder(order.id, patch);
            setOpen(false);
          }}
        >
          <div className={styles.modifyTitle}>
            Modify {typeText(order).toLowerCase()} · {order.symbol}
          </div>
          <label>
            Quantity
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" disabled={order.role !== 'entry'} />
          </label>
          {order.type !== 'market' && (
            <label>
              {order.type === 'limit' ? 'Limit price' : 'Stop price'}
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" step={spec.tickSize} autoFocus />
            </label>
          )}
          <button type="submit" className={styles.modifySubmit}>
            Modify
          </button>
        </form>
      </Popover>
    </>
  );
}

function HistoryTable() {
  const orders = useTradingStore((s) => s.engine.orders)
    .filter((o) => o.status !== 'working')
    .sort((a, b) => (b.filledAt ?? b.updatedAt) - (a.filledAt ?? a.updatedAt) || Number(b.id) - Number(a.id));
  return (
    <Table
      head={['Symbol', 'Side', 'Type', 'Quantity', 'Limit price', 'Stop price', 'Fill price', 'Status', 'Placing time', 'Closing time', 'Order ID', 'Message']}
      empty="There is no order history yet"
    >
      {orders.map((o) => {
        const spec = getSpec(o.symbol);
        return (
          <tr key={o.id}>
            <td>
              <SymbolCell symbol={o.symbol} />
            </td>
            <td>
              <SideCell side={o.side} />
            </td>
            <td>{typeText(o)}</td>
            <td className="tabular">{fmtQty(o.qty, spec)}</td>
            <td className="tabular">{o.limitPrice !== undefined ? fmtPrice(o.limitPrice, spec) : ''}</td>
            <td className="tabular">{o.stopPrice !== undefined ? fmtPrice(o.stopPrice, spec) : ''}</td>
            <td className="tabular">{o.fillPrice !== undefined ? fmtPrice(o.fillPrice, spec) : ''}</td>
            <td className={STATUS_CLASS[o.status]}>{o.status[0].toUpperCase() + o.status.slice(1)}</td>
            <td className="tabular">{fmtDateTime(o.createdAt)}</td>
            <td className="tabular">{fmtDateTime(o.filledAt ?? o.updatedAt)}</td>
            <td className="tabular">{o.id}</td>
            <td className={styles.muted}>{o.rejectReason ?? ''}</td>
          </tr>
        );
      })}
    </Table>
  );
}

function AccountSummaryView() {
  const sum = useAccountSummary();
  const engine = useTradingStore((s) => s.engine);
  const reset = useTradingStore((s) => s.resetAccount);
  const rows: [string, string][] = [
    ['Initial balance', fmtMoney(engine.initialBalance)],
    ['Account balance', fmtMoney(sum.balance)],
    ['Equity', fmtMoney(sum.equity)],
    ['Realized P&L', fmtMoney(sum.realizedPnl)],
    ['Unrealized P&L', fmtMoney(sum.unrealizedPnl)],
    ['Account margin', fmtMoney(sum.accountMargin)],
    ['Orders margin', fmtMoney(sum.ordersMargin)],
    ['Available funds', fmtMoney(sum.availableFunds)],
    ['Margin buffer', fmtPercent(sum.equity > 0 ? ((sum.equity - sum.accountMargin) / sum.equity) * 100 : 0)],
    ['Trades', fmtNumber(engine.fills.length, 0)],
  ];
  return (
    <div className={styles.summary}>
      <dl className={styles.summaryList}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="tabular">{v} USD</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className={styles.resetBtn}
        onClick={() => {
          if (window.confirm('Reset paper trading account? All positions, orders and history will be removed.')) reset();
        }}
        data-testid="reset-account"
      >
        <RotateCcw size={14} /> Reset account
      </button>
    </div>
  );
}

function NotificationsLog() {
  const log = useTradingStore((s) => s.log);
  return (
    <Table head={['Time', 'Symbol', 'Event', 'Text']} empty="No notifications yet">
      {log
        .slice()
        .reverse()
        .map((e, i) => (
          <tr key={i}>
            <td className="tabular">{fmtDateTime(e.time)}</td>
            <td>{e.symbol}</td>
            <td className={e.type === 'rejected' ? styles.neg : e.type === 'expired' ? styles.warn : ''}>{e.type}</td>
            <td>{e.message}</td>
          </tr>
        ))}
    </Table>
  );
}
