export type FeedMode = 'sim' | 'binance' | 'finnhub' | 'live';
export type PanelVariant = 'current' | 'new';

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

function pick<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const FEEDS = ['sim', 'binance', 'finnhub', 'live'] as const;
const PANELS = ['current', 'new'] as const;

/**
 * Feed selection. URL `?feed=` wins over `VITE_FEED`; default is `sim`.
 * - sim: everything simulated (no network)
 * - binance: crypto from Binance, the rest simulated
 * - finnhub: US stocks from Finnhub (needs VITE_FINNHUB_KEY), the rest simulated
 * - live: each symbol from its native feed
 */
export const FEED_MODE: FeedMode = pick(params.get('feed') ?? import.meta.env.VITE_FEED, FEEDS, 'sim');

export const PANEL_VARIANT: PanelVariant = pick(params.get('panel') ?? import.meta.env.VITE_PANEL, PANELS, 'current');

export const DEBUG = params.get('debug') === '1';

export const FINNHUB_KEY: string | undefined = import.meta.env.VITE_FINNHUB_KEY || undefined;

export const THEME: 'light' | 'dark' = params.get('theme') === 'dark' ? 'dark' : 'light';
