import { pricePrecision, qtyPrecision, type SymbolSpec } from '../config/symbols';

const MINUS = '−';

const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number, grouping: boolean): Intl.NumberFormat {
  const key = `${min}:${max}:${grouping}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping });
    cache.set(key, f);
  }
  return f;
}

/** Number with fixed decimals, thousands separators and a typographic minus. */
export function fmtNumber(n: number, digits = 2, opts: { grouping?: boolean; sign?: boolean } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const s = nf(digits, digits, opts.grouping ?? true).format(Math.abs(n));
  if (n < 0 && Number(s.replace(/,/g, '')) !== 0) return MINUS + s;
  if (opts.sign && n > 0) return '+' + s;
  return s;
}

export function fmtPrice(n: number, spec: Pick<SymbolSpec, 'tickSize'>, opts: { grouping?: boolean; sign?: boolean } = {}): string {
  return fmtNumber(n, pricePrecision(spec), opts);
}

/** Price for editable inputs: no grouping. */
export function priceInput(n: number, spec: Pick<SymbolSpec, 'tickSize'>): string {
  return n.toFixed(pricePrecision(spec));
}

export function fmtQty(n: number, spec: Pick<SymbolSpec, 'qtyStep'>): string {
  const d = qtyPrecision(spec);
  return nf(0, d, true).format(n);
}

export function fmtMoney(n: number, opts: { sign?: boolean } = {}): string {
  return fmtNumber(n, 2, opts);
}

export function fmtPercent(n: number, digits = 2, opts: { sign?: boolean } = {}): string {
  return `${fmtNumber(n, digits, opts)}%`;
}

/** Parses user input ("1,234.5", "1 234,5" is not supported) into a number; empty → NaN. */
export function parseNum(s: string): number {
  const t = s.replace(/[,\s]/g, '').replace(MINUS, '-');
  if (t === '' || t === '-' || t === '.') return Number.NaN;
  return Number(t);
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
