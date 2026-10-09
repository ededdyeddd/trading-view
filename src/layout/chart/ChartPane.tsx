import { CalendarRange } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSpec } from '../../config/symbols';
import { fmtNumber, fmtPrice } from '../../lib/format';
import { useQuote } from '../../market/marketStore';
import type { Candle } from '../../market/types';
import { useUiStore } from '../../store/uiStore';
import { SymbolLogo } from '../../ui/SymbolLogo';
import { CandleChart, type ChartHandle } from './CandleChart';
import styles from './ChartPane.module.css';
import { QuickTrade } from './QuickTrade';

const TF_LABEL: Record<string, string> = { '1m': '1', '5m': '5', '15m': '15', '1h': '1h', '4h': '4h', '1D': '1D' };
const RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'];

/** Chart handle shared with future order-line overlays (step 2). */
export const chartHandleRef: { current: ChartHandle | null } = { current: null };

export function ChartPane() {
  const symbol = useUiStore((s) => s.symbol);
  const timeframe = useUiStore((s) => s.timeframe);
  const chartType = useUiStore((s) => s.chartType);
  const [bar, setBar] = useState<{ bar: Candle | null; prev: Candle | null }>({ bar: null, prev: null });

  return (
    <div className={styles.pane}>
      <div className={styles.chartArea}>
        <CandleChart
          symbol={symbol}
          timeframe={timeframe}
          chartType={chartType}
          onBar={(b, prev) => setBar({ bar: b, prev })}
          onReady={(h) => (chartHandleRef.current = h)}
        />
        <div className={styles.overlay}>
          <Legend symbol={symbol} tf={TF_LABEL[timeframe]} bar={bar.bar} prev={bar.prev} />
          <QuickTrade symbol={symbol} />
        </div>
      </div>
      <div className={styles.rangeBar}>
        {RANGES.map((r) => (
          <button key={r} className={styles.rangeBtn} type="button">
            {r}
          </button>
        ))}
        <span className={styles.sep} />
        <button className={styles.iconBtn} type="button" aria-label="Go to date">
          <CalendarRange size={18} strokeWidth={1.5} />
        </button>
        <span className={styles.spacer} />
        <Clock />
        <span className={styles.rangeBtn}>RTH</span>
        <span className={styles.sep} />
        <span className={styles.rangeBtn}>ADJ</span>
      </div>
    </div>
  );
}

function Legend({ symbol, tf, bar, prev }: { symbol: string; tf: string; bar: Candle | null; prev: Candle | null }) {
  const spec = getSpec(symbol);
  const quote = useQuote(symbol);
  const change = bar && prev ? bar.close - prev.close : null;
  const changePct = change !== null && prev ? (change / prev.close) * 100 : null;
  const tone = bar ? (bar.close >= bar.open ? styles.up : styles.down) : '';
  return (
    <div className={styles.legend}>
      <div className={styles.legendRow}>
        <SymbolLogo symbol={symbol} size={18} />
        <span className={styles.legendTitle}>
          {spec.name} · {tf} · {spec.exchange}
        </span>
        <span className={styles.marketDot} title={quote ? 'Market open' : 'Connecting…'} />
        {bar && (
          <span className={`${styles.ohlc} tabular`}>
            <span>O</span>
            <b className={tone}>{fmtPrice(bar.open, spec)}</b>
            <span>H</span>
            <b className={tone}>{fmtPrice(bar.high, spec)}</b>
            <span>L</span>
            <b className={tone}>{fmtPrice(bar.low, spec)}</b>
            <span>C</span>
            <b className={tone}>{fmtPrice(bar.close, spec)}</b>
            {change !== null && changePct !== null && (
              <b className={tone}>
                {fmtPrice(change, spec, { sign: true })} ({fmtNumber(changePct, 2, { sign: true })}%)
              </b>
            )}
          </span>
        )}
      </div>
      {bar && (
        <div className={styles.volRow}>
          Vol <b className={`${tone} tabular`}>{fmtVolume(bar.volume)}</b>
        </div>
      )}
    </div>
  );
}

function fmtVolume(v: number): string {
  if (v >= 1e6) return `${fmtNumber(v / 1e6, 2)} M`;
  if (v >= 1e3) return `${fmtNumber(v / 1e3, 2)} K`;
  return fmtNumber(v, v < 10 ? 4 : 0);
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <span className={`${styles.clock} tabular`}>
      {pad(now.getUTCHours())}:{pad(now.getUTCMinutes())}:{pad(now.getUTCSeconds())} UTC
    </span>
  );
}
