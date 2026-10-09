import { FEED_MODE, MARKET_CLOSED } from '../config/flags';
import { getSpec } from '../config/symbols';

/** US equity regular session: 09:30–16:00 America/New_York, Monday to Friday. */
const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const ET = 'America/New_York';

type EtParts = { weekday: number; minutes: number };

function etParts(ts: number): EtParts {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(f.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function isRegularSession(ts: number): boolean {
  const { weekday, minutes } = etParts(ts);
  return weekday >= 1 && weekday <= 5 && minutes >= OPEN_MIN && minutes < CLOSE_MIN;
}

/** Next 09:30 ET strictly after `ts` (minute resolution). */
export function nextUsOpen(ts: number): number {
  let t = Math.floor(ts / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 8 * 24 * 60; i++, t += 60_000) {
    const { weekday, minutes } = etParts(t);
    if (weekday >= 1 && weekday <= 5 && minutes === OPEN_MIN) return t;
  }
  return ts;
}

/**
 * When the symbol's session is closed, returns the next open (ms); otherwise null.
 * `?market=closed` forces a closed US session for stocks; with the Finnhub feed real hours apply.
 * Crypto trades 24/7; forex and simulated stocks are treated as open.
 */
export function sessionOpensAt(symbol: string, now: number): number | null {
  const spec = getSpec(symbol);
  if (spec.assetClass !== 'stock') return null;
  if (MARKET_CLOSED) return nextUsOpen(now);
  if ((FEED_MODE === 'finnhub' || FEED_MODE === 'live') && !isRegularSession(now)) return nextUsOpen(now);
  return null;
}
