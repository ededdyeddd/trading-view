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

/** Atom gallery for the redesigned panel (?sandbox=1). */
export const SANDBOX: 'atoms' | 'panel' | null = params.get('sandbox') === '1' ? 'atoms' : params.get('sandbox') === 'panel' ? 'panel' : null;

/** Freeze simulated prices (AAPL 201.56 / 201.57) for pixel comparisons (?freeze=1). */
export const FREEZE = params.get('freeze') === '1';

/** Force a closed US stock session (?market=closed). */
export const MARKET_CLOSED = params.get('market') === 'closed';

/** Shorten order lifetimes for expiry testing (?expireFast=1): Day = 1 min, Week = 3 min, Month = 10 min. */
export const EXPIRE_FAST = params.get('expireFast') === '1';

/** Draw ticket levels on the chart and let them be dragged (?chartLines=1), for both panels. */
export const CHART_LINES = params.get('chartLines') === '1';

/** Deterministic simulator seed (?seed=…), used by study scenarios. */
export const SEED: number | null = params.get('seed') !== null ? Number(params.get('seed')) || 0 : null;

/** Usability study: `?study=1` setup screen, `?study=run` a scenario run, `?study=done` the summary. */
export const STUDY: 'setup' | 'run' | 'done' | null =
  params.get('study') === '1' ? 'setup' : params.get('study') === 'run' ? 'run' : params.get('study') === 'done' ? 'done' : null;
export const STUDY_PID = params.get('pid') ?? '';
export const STUDY_SCENARIO = Number(params.get('scenario')) || 0;
