import {
  AlarmClockPlus,
  BarChart3,
  Camera,
  CandlestickChart,
  ChevronDown,
  CirclePlus,
  LayoutGrid,
  LineChart,
  Maximize,
  Redo2,
  Rewind,
  Search,
  Settings,
  Undo2,
  Zap,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { SYMBOLS } from '../config/symbols';
import { fmtPrice } from '../lib/format';
import { useMarketStore } from '../market/marketStore';
import { TIMEFRAMES } from '../market/types';
import { useUiStore, type ChartType } from '../store/uiStore';
import { MenuItem, Popover } from '../ui/Popover';
import { SymbolLogo } from '../ui/SymbolLogo';
import { FeedBadge } from './FeedBadge';
import styles from './TopToolbar.module.css';

const TF_LABEL: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': 'D' };
const CHART_TYPES: { id: ChartType; label: string; icon: typeof CandlestickChart }[] = [
  { id: 'candles', label: 'Candles', icon: CandlestickChart },
  { id: 'bars', label: 'Bars', icon: BarChart3 },
  { id: 'line', label: 'Line', icon: LineChart },
];

export function TopToolbar() {
  const symbol = useUiStore((s) => s.symbol);
  const timeframe = useUiStore((s) => s.timeframe);
  const chartType = useUiStore((s) => s.chartType);
  const setTimeframe = useUiStore((s) => s.setTimeframe);
  const setChartType = useUiStore((s) => s.setChartType);
  const openTicket = useUiStore((s) => s.openTicket);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeRef = useRef<HTMLButtonElement>(null);
  const TypeIcon = CHART_TYPES.find((t) => t.id === chartType)?.icon ?? CandlestickChart;

  return (
    <header className={styles.toolbar}>
      <div className={styles.avatarCell}>
        <span className={styles.avatar}>E</span>
      </div>
      <div className={styles.scroll}>
        <SymbolSearch symbol={symbol} />
        <IconBtn label="Compare or add symbol">
          <CirclePlus size={20} strokeWidth={1.4} />
        </IconBtn>
        <Sep />
        <div className={styles.group} role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" className={`${styles.btn} ${styles.tf} ${tf === timeframe ? styles.selected : ''}`} onClick={() => setTimeframe(tf)}>
              {TF_LABEL[tf]}
            </button>
          ))}
        </div>
        <Sep />
        <button ref={typeRef} type="button" className={`${styles.btn} ${styles.icon}`} aria-label="Chart type" onClick={() => setTypeOpen((v) => !v)}>
          <TypeIcon size={20} strokeWidth={1.4} />
        </button>
        <Popover anchor={typeRef} open={typeOpen} onClose={() => setTypeOpen(false)}>
          {CHART_TYPES.map((t) => (
            <MenuItem key={t.id} active={t.id === chartType} onSelect={() => (setChartType(t.id), setTypeOpen(false))}>
              <t.icon size={18} strokeWidth={1.4} /> {t.label}
            </MenuItem>
          ))}
        </Popover>
        <Sep />
        <button type="button" className={styles.btn}>
          <Zap size={20} strokeWidth={1.4} /> Indicators
        </button>
        <IconBtn label="Indicator templates">
          <LayoutGrid size={20} strokeWidth={1.4} />
        </IconBtn>
        <Sep />
        <button type="button" className={styles.btn}>
          <AlarmClockPlus size={20} strokeWidth={1.4} /> Alert
        </button>
        <button type="button" className={styles.btn}>
          <Rewind size={20} strokeWidth={1.4} /> Replay
        </button>
        <Sep />
        <IconBtn label="Undo">
          <Undo2 size={18} strokeWidth={1.4} />
        </IconBtn>
        <IconBtn label="Redo">
          <Redo2 size={18} strokeWidth={1.4} />
        </IconBtn>
        <span className={styles.spacer} />
        <FeedBadge symbol={symbol} />
        <button type="button" className={styles.btn}>
          Unnamed <ChevronDown size={16} strokeWidth={1.4} />
        </button>
        <IconBtn label="Quick search">
          <Search size={18} strokeWidth={1.4} />
        </IconBtn>
        <IconBtn label="Settings">
          <Settings size={18} strokeWidth={1.4} />
        </IconBtn>
        <IconBtn label="Fullscreen">
          <Maximize size={18} strokeWidth={1.4} />
        </IconBtn>
        <IconBtn label="Snapshot">
          <Camera size={18} strokeWidth={1.4} />
        </IconBtn>
      </div>
      <div className={styles.right}>
        <button type="button" className={styles.trade} onClick={() => openTicket('header')}>
          Trade
        </button>
        <button type="button" className={styles.upgrade}>
          Publish
        </button>
      </div>
    </header>
  );
}

function IconBtn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button type="button" className={`${styles.btn} ${styles.icon}`} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function Sep() {
  return <span className={styles.sep} />;
}

function SymbolSearch({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const setSymbol = useUiStore((s) => s.setSymbol);
  const quotes = useMarketStore((s) => s.quotes);
  const list = SYMBOLS.filter((s) => !query || s.symbol.toLowerCase().includes(query.toLowerCase()) || s.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <button ref={ref} type="button" className={styles.symbolBtn} onClick={() => setOpen((v) => !v)} data-testid="symbol-search">
        <Search size={16} strokeWidth={1.6} />
        <span className={styles.symbolText}>{symbol}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => (setOpen(false), setQuery(''))}>
        <div className={styles.searchBox}>
          <Search size={16} strokeWidth={1.6} />
          <input autoFocus placeholder="Symbol search" value={query} onChange={(e) => setQuery(e.target.value)} className={styles.searchInput} />
        </div>
        <div className={styles.searchList}>
          {list.map((s) => (
            <MenuItem
              key={s.symbol}
              active={s.symbol === symbol}
              onSelect={() => {
                setSymbol(s.symbol);
                setOpen(false);
                setQuery('');
              }}
              end={quotes[s.symbol] ? fmtPrice(quotes[s.symbol].last, s) : ''}
            >
              <SymbolLogo symbol={s.symbol} size={18} />
              <b className={styles.searchSym}>{s.symbol}</b>
              <span className={styles.searchName}>{s.name}</span>
            </MenuItem>
          ))}
        </div>
      </Popover>
    </>
  );
}
