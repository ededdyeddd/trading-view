import { LineStyle, type IPriceLine } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { logEvent } from '../../analytics/eventLog';
import { fmtMoney, fmtQty, offsetInput, priceInput } from '../../lib/format';
import { describeExit, marketRef, roundToTick } from '../../lib/orderMath';
import { exitInputText, useOrderTicket, useTicketStore, type OrderTicket } from '../../order-ticket/ticketStore';
import type { ChartHandle } from './CandleChart';

/** 'sl' / 'tp' = Level 1; `p${n}sl` / `p${n}tp` = the n-th partial exit (n from 0). */
type LineId = 'entry' | 'sl' | 'tp' | `p${number}sl` | `p${number}tp`;
type LineSpec = { id: LineId; price: number; color: string; title: string };

const HIT_PX = 6;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function signedUsd(n: number): string {
  return `${fmtMoney(n, { sign: true })} USD`;
}

/** Lines for the open ticket: entry (Limit/Stop), SL (red) and TP levels (green), with price and money on the label. */
function linesFor(ticket: OrderTicket): LineSpec[] {
  const { state, view, spec } = ticket;
  const out: LineSpec[] = [];
  const qty = view.qty.units;
  if (state.type !== 'market' && view.price?.value != null) {
    const kind = state.type === 'limit' ? 'LMT' : 'STP';
    out.push({
      id: 'entry',
      price: view.price.value,
      color: cssVar('--color-blue'),
      title: `${state.side === 'buy' ? 'Buy' : 'Sell'} ${kind}${qty > 0 ? ` ${fmtQty(qty, spec)}` : ''}`,
    });
  }
  if (view.sl.enabled && view.sl.level && !view.sl.level.invalid) {
    out.push({ id: 'sl', price: view.sl.level.price, color: cssVar('--color-red'), title: `SL${qty > 0 ? ` ${signedUsd(view.sl.level.money)}` : ''}` });
  }
  if (view.tp.enabled && view.tp.level && !view.tp.level.invalid) {
    out.push({ id: 'tp', price: view.tp.level.price, color: cssVar('--color-green'), title: `TP${qty > 0 ? ` ${signedUsd(view.tp.level.money)}` : ''}` });
  }
  view.partials.forEach((p, i) => {
    const n = i + 2;
    if (p.sl.level && !p.sl.level.invalid) out.push({ id: `p${i}sl`, price: p.sl.level.price, color: cssVar('--color-red'), title: `SL${n} ${signedUsd(p.sl.level.money)}` });
    if (p.tp.level && !p.tp.level.invalid) out.push({ id: `p${i}tp`, price: p.tp.level.price, color: cssVar('--color-green'), title: `TP${n} ${signedUsd(p.tp.level.money)}` });
  });
  return out;
}

/**
 * Draws the ticket's levels on the chart while it is open (?chartLines=1) and lets the user drag them.
 * A drag writes the new level back into the panel field in that field's current unit. Works for both panels.
 */
export function OrderLines({ handle }: { handle: ChartHandle | null }) {
  const ticket = useOrderTicket();
  const lines = useRef(new Map<LineId, IPriceLine>());
  const specs = linesFor(ticket);
  const latest = useRef({ ticket, specs });
  latest.current = { ticket, specs };

  // Create / update / remove price lines.
  useEffect(() => {
    if (!handle) return;
    const map = lines.current;
    const seen = new Set<LineId>();
    for (const l of specs) {
      seen.add(l.id);
      const opts = { price: l.price, color: l.color, lineWidth: 1 as const, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.title };
      const existing = map.get(l.id);
      if (existing) existing.applyOptions(opts);
      else map.set(l.id, handle.series.createPriceLine(opts));
    }
    for (const [id, line] of map) {
      if (!seen.has(id)) {
        handle.series.removePriceLine(line);
        map.delete(id);
      }
    }
  });

  // Keep every level in view: extend the series' autoscale range with the line prices.
  useEffect(() => {
    if (!handle) return;
    handle.series.applyOptions({
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
        const base = original();
        const prices = latest.current.specs.map((l) => l.price);
        if (!base?.priceRange || prices.length === 0) return base;
        return {
          ...base,
          priceRange: {
            minValue: Math.min(base.priceRange.minValue, ...prices),
            maxValue: Math.max(base.priceRange.maxValue, ...prices),
          },
        };
      },
    });
    return () => {
      handle.series.applyOptions({ autoscaleInfoProvider: undefined });
    };
  }, [handle]);

  // Remove everything when the chart/series changes or the component unmounts.
  useEffect(() => {
    const map = lines.current;
    return () => {
      if (handle) for (const line of map.values()) handle.series.removePriceLine(line);
      map.clear();
    };
  }, [handle]);

  // Dragging.
  useEffect(() => {
    if (!handle) return;
    const el = handle.chart.chartElement();
    let dragging: LineId | null = null;

    const yOf = (e: MouseEvent) => e.clientY - el.getBoundingClientRect().top;
    const hit = (y: number): LineId | null => {
      for (const l of latest.current.specs) {
        const c = handle.series.priceToCoordinate(l.price);
        if (c !== null && Math.abs(c - y) <= HIT_PX) return l.id;
      }
      return null;
    };

    const apply = (id: LineId, rawPrice: number) => {
      const { ticket: tk } = latest.current;
      const { state, view, spec } = tk;
      const store = useTicketStore.getState();
      const price = roundToTick(rawPrice, spec.tickSize);
      if (id === 'entry') {
        if (state.priceUnit === 'offset') store.setPriceInput(offsetInput(price - marketRef(state.side, view.bid, view.ask), spec));
        else store.setPriceInput(priceInput(price, spec));
        return;
      }
      if (view.entry === null) return;
      const partial = /^p(\d+)(sl|tp)$/.exec(id);
      const kind: 'sl' | 'tp' = partial ? (partial[2] as 'sl' | 'tp') : id === 'sl' ? 'sl' : 'tp';
      const index = partial ? Number(partial[1]) : -1;
      const qty = index >= 0 ? view.partials[index]?.qty : view.level1Qty;
      const level = describeExit(kind, state.side, view.entry, qty > 0 ? qty : 1, price, tk.account.balance, spec);
      if (level.invalid) return; // never drag a level across the entry
      if (index >= 0) store.setPartialLeg(index, kind, exitInputText(level, state.partials[index][kind].unit, spec));
      else store.setExitInput(kind, exitInputText(level, state[kind].unit, spec));
    };

    const onDown = (e: MouseEvent) => {
      const id = hit(yOf(e));
      if (!id) return;
      dragging = id;
      e.preventDefault();
      e.stopImmediatePropagation();
      handle.chart.applyOptions({ handleScroll: false, handleScale: false });
      logEvent('field_change', { field: `chart-line:${id}`, value: 'drag-start' });
    };
    const onMove = (e: MouseEvent) => {
      const y = yOf(e);
      if (dragging) {
        const p = handle.series.coordinateToPrice(y);
        if (p !== null) apply(dragging, p);
        e.preventDefault();
        return;
      }
      if (e.target instanceof Node && el.contains(e.target)) el.style.cursor = hit(y) ? 'ns-resize' : '';
    };
    const onUp = () => {
      if (!dragging) return;
      logEvent('field_change', { field: `chart-line:${dragging}`, value: 'drag-end' });
      dragging = null;
      handle.chart.applyOptions({ handleScroll: true, handleScale: true });
    };

    el.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    return () => {
      el.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      el.style.cursor = '';
    };
  }, [handle]);

  return null;
}
