import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { getSpec, pricePrecision } from '../../config/symbols';
import { getHistory, useMarketStore } from '../../market/marketStore';
import { barTime, type Candle, type Timeframe } from '../../market/types';
import type { ChartType } from '../../store/uiStore';
import styles from './CandleChart.module.css';

export type ChartHandle = {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
};

type Props = {
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  /** Hovered bar (or the live bar when the crosshair is away). */
  onBar: (bar: Candle | null, prev: Candle | null) => void;
  /** Exposes the chart/series so step 2 can draw order lines (Limit, SL, TP). */
  onReady?: (handle: ChartHandle | null) => void;
};

const HISTORY_LIMIT = 500;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function CandleChart({ symbol, timeframe, chartType, onBar, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const onBarRef = useRef(onBar);
  onBarRef.current = onBar;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Chart instance lives for the component lifetime.
  useEffect(() => {
    const el = containerRef.current!;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: cssVar('--chart-bg') },
        textColor: cssVar('--chart-text'),
        fontFamily: cssVar('--font-family'),
        fontSize: 12,
      },
      grid: {
        vertLines: { color: cssVar('--chart-grid') },
        horzLines: { color: cssVar('--chart-grid') },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: cssVar('--chart-crosshair'), style: LineStyle.Dashed, labelBackgroundColor: '#131722' },
        horzLine: { color: cssVar('--chart-crosshair'), style: LineStyle.Dashed, labelBackgroundColor: '#131722' },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.2 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 8 },
    });
    chartRef.current = chart;
    return () => {
      onReadyRef.current?.(null);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Series + data per symbol / timeframe / chart type.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const spec = getSpec(symbol);
    const up = cssVar('--chart-up');
    const down = cssVar('--chart-down');
    const priceFormat = { type: 'price' as const, precision: pricePrecision(spec), minMove: spec.tickSize };

    let series: ISeriesApi<SeriesType>;
    if (chartType === 'line') {
      series = chart.addSeries(LineSeries, { color: cssVar('--color-blue'), lineWidth: 2, priceFormat });
    } else if (chartType === 'bars') {
      series = chart.addSeries(BarSeries, { upColor: up, downColor: down, priceFormat, thinBars: false });
    } else {
      series = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        borderVisible: false,
        wickUpColor: up,
        wickDownColor: down,
        priceFormat,
      });
    }
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const volUp = cssVar('--chart-volume-up');
    const volDown = cssVar('--chart-volume-down');
    let bars: Candle[] = [];
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let hovering = false;

    const toSeries = (c: Candle) =>
      chartType === 'line'
        ? { time: c.time as UTCTimestamp, value: c.close }
        : { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
    const toVolume = (c: Candle) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? volUp : volDown });

    const emitLast = () => {
      if (hovering || bars.length === 0) return;
      onBarRef.current(bars[bars.length - 1], bars[bars.length - 2] ?? null);
    };

    onBarRef.current(null, null);

    getHistory(symbol, timeframe, HISTORY_LIMIT).then((history) => {
      if (cancelled) return;
      bars = history.slice();
      series.setData(bars.map(toSeries));
      volume.setData(bars.map(toVolume));
      chart.timeScale().scrollToRealTime();
      emitLast();
      onReadyRef.current?.({ chart, series });

      // Live bar: the same flushed quotes every other consumer sees.
      unsubscribe = useMarketStore.subscribe((s, prev) => {
        const q = s.quotes[symbol];
        if (!q || q === prev.quotes[symbol] || bars.length === 0) return;
        const t = barTime(Date.now(), timeframe);
        const last = bars[bars.length - 1];
        const price = q.last;
        let bar: Candle;
        if (t > last.time) {
          bar = { time: t, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: q.size ?? 0 };
          bars.push(bar);
        } else if (t === last.time) {
          bar = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price, volume: last.volume + (q.size ?? 0) };
          bars[bars.length - 1] = bar;
        } else {
          return;
        }
        series.update(toSeries(bar));
        volume.update(toVolume(bar));
        emitLast();
      });
    });

    const onMove = (param: Parameters<Parameters<IChartApi['subscribeCrosshairMove']>[0]>[0]) => {
      if (!param.time || bars.length === 0) {
        hovering = false;
        emitLast();
        return;
      }
      hovering = true;
      const idx = bars.findIndex((b) => b.time === param.time);
      if (idx >= 0) onBarRef.current(bars[idx], bars[idx - 1] ?? null);
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      cancelled = true;
      unsubscribe?.();
      onReadyRef.current?.(null);
      // The chart may already be disposed when the whole component unmounts.
      if (chartRef.current !== chart) return;
      chart.unsubscribeCrosshairMove(onMove);
      chart.removeSeries(series);
      chart.removeSeries(volume);
    };
  }, [symbol, timeframe, chartType]);

  return <div ref={containerRef} className={styles.chart} />;
}
