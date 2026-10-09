import {
  AlarmClock,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Grid3x3,
  Layers,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Rss,
  Sparkles,
  Target,
} from 'lucide-react';
import { memo, useState } from 'react';
import { SYMBOL_GROUPS, SYMBOLS, getSpec } from '../../config/symbols';
import { fmtNumber, fmtPercent, fmtPrice } from '../../lib/format';
import { useMarketStore, useQuote } from '../../market/marketStore';
import { useUiStore } from '../../store/uiStore';
import { SymbolLogo } from '../../ui/SymbolLogo';
import styles from './Widgetbar.module.css';

export function Widgetbar() {
  return (
    <aside className={styles.widgetbar}>
      <div className={styles.pages}>
        <Watchlist />
        <SymbolDetails />
      </div>
      <TabsColumn />
    </aside>
  );
}

function Watchlist() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <section className={styles.watchlist}>
      <div className={styles.widgetHeader}>
        <button type="button" className={styles.headerTitle}>
          Watchlist <ChevronDown size={16} strokeWidth={1.5} />
        </button>
        <span className={styles.spacer} />
        <button type="button" className={styles.headerIcon} aria-label="Add symbol">
          <Plus size={18} strokeWidth={1.4} />
        </button>
        <button type="button" className={styles.headerIcon} aria-label="More">
          <MoreHorizontal size={18} strokeWidth={1.4} />
        </button>
      </div>
      <div className={styles.columns}>
        <span className={styles.colSymbol}>Symbol</span>
        <span>Last</span>
        <span>Chg</span>
        <span>Chg%</span>
      </div>
      <div className={styles.rows}>
        {SYMBOL_GROUPS.map((g) => (
          <div key={g.title}>
            <button type="button" className={styles.groupTitle} onClick={() => setCollapsed((c) => ({ ...c, [g.title]: !c[g.title] }))}>
              {collapsed[g.title] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              {g.title.toUpperCase()}
            </button>
            {!collapsed[g.title] && SYMBOLS.filter((s) => s.assetClass === g.assetClass).map((s) => <WatchRow key={s.symbol} symbol={s.symbol} />)}
          </div>
        ))}
      </div>
    </section>
  );
}

const WatchRow = memo(function WatchRow({ symbol }: { symbol: string }) {
  const spec = getSpec(symbol);
  const quote = useQuote(symbol);
  const prevClose = useMarketStore((s) => s.prevClose[symbol]);
  const selected = useUiStore((s) => s.symbol === symbol);
  const setSymbol = useUiStore((s) => s.setSymbol);
  const chg = quote && prevClose ? quote.last - prevClose : null;
  const chgPct = chg !== null && prevClose ? (chg / prevClose) * 100 : null;
  const tone = chg === null ? '' : chg >= 0 ? styles.up : styles.down;
  return (
    <button type="button" className={`${styles.row} ${selected ? styles.selected : ''}`} onClick={() => setSymbol(symbol)} data-testid={`watch-${symbol}`}>
      <span className={styles.colSymbol}>
        <SymbolLogo symbol={symbol} size={18} />
        <span className={styles.sym}>{symbol}</span>
      </span>
      <span className="tabular">{quote ? fmtPrice(quote.last, spec) : '—'}</span>
      <span className={`tabular ${tone}`}>{chg !== null ? fmtPrice(chg, spec) : ''}</span>
      <span className={`tabular ${tone}`}>{chgPct !== null ? fmtPercent(chgPct) : ''}</span>
    </button>
  );
});

function SymbolDetails() {
  const symbol = useUiStore((s) => s.symbol);
  const spec = getSpec(symbol);
  const quote = useQuote(symbol);
  const prevClose = useMarketStore((s) => s.prevClose[symbol]);
  const status = useMarketStore((s) => s.status[symbol]);
  const chg = quote && prevClose ? quote.last - prevClose : null;
  const chgPct = chg !== null && prevClose ? (chg / prevClose) * 100 : null;
  const tone = chg === null ? '' : chg >= 0 ? styles.up : styles.down;
  return (
    <section className={styles.details}>
      <div className={styles.detailsHead}>
        <SymbolLogo symbol={symbol} size={24} />
        <span className={styles.detailsSymbol}>{symbol}</span>
      </div>
      <div className={styles.detailsSub}>
        {spec.name} · {spec.exchange}
      </div>
      <div className={styles.detailsPriceRow}>
        <span className={`${styles.detailsPrice} tabular`}>{quote ? fmtPrice(quote.last, spec) : '—'}</span>
        <span className={styles.detailsCcy}>{spec.currency}</span>
        {chg !== null && chgPct !== null && (
          <span className={`${styles.detailsChg} ${tone} tabular`}>
            {fmtPrice(chg, spec, { sign: true })} {fmtNumber(chgPct, 2, { sign: true })}%
          </span>
        )}
      </div>
      <div className={styles.detailsStatus}>
        <span className={styles.statusDot} /> Market open
        {status && <span className={styles.feedName}> · {status.active === 'sim' ? 'simulated feed' : `${status.active} feed`}</span>}
      </div>
    </section>
  );
}

const TABS = [
  { icon: ListChecks, label: 'Watchlist', active: true },
  { icon: AlarmClock, label: 'Alerts' },
  { icon: Layers, label: 'Object tree' },
  null,
  { icon: Sparkles, label: 'Assistant' },
  { icon: Target, label: 'Screeners' },
  { icon: CalendarDays, label: 'Calendars' },
  { icon: Rss, label: 'News' },
  { icon: Bell, label: 'Notifications' },
  { icon: MessageSquare, label: 'Chats' },
  { icon: Grid3x3, label: 'Products' },
  { icon: CircleHelp, label: 'Help' },
];

function TabsColumn() {
  return (
    <nav className={styles.tabs} aria-label="Widgets">
      {TABS.map((t, i) =>
        t === null ? (
          <span key={i} className={styles.tabsSpacer} />
        ) : (
          <button key={t.label} type="button" title={t.label} aria-label={t.label} className={`${styles.tab} ${t.active ? styles.tabActive : ''}`}>
            <t.icon size={22} strokeWidth={1.3} />
          </button>
        ),
      )}
    </nav>
  );
}
