export type AssetClass = 'stock' | 'crypto' | 'forex';
export type FeedKind = 'binance' | 'finnhub' | 'sim';

export type SymbolSpec = {
  symbol: string;
  name: string;
  exchange: string;
  assetClass: AssetClass;
  /** Minimal price increment. */
  tickSize: number;
  /** Forex: one pip (0.0001, JPY pairs 0.01). Where set, distances and the value of a step are shown in pips instead of ticks. */
  pipSize?: number;
  /** Quote-currency value of a 1.0 price move for 1 unit of quantity. */
  pointValue: number;
  /** Quote currency of the instrument (P&L currency before conversion). */
  currency: string;
  /** Initial margin as a fraction of notional (stocks: 0.02 → 2%). */
  marginRate: number;
  /** Leverage for crypto/forex; margin = notional / leverage. Overrides marginRate when set. */
  leverage?: number;
  minQty: number;
  qtyStep: number;
  /** Label for quantity units in the order ticket. */
  qtyLabel: string;
  /** Native live feed for this symbol (used when ?feed=live or the matching feed is selected). */
  liveFeed: FeedKind;
  /** Simulator seed: starting bid and spread (in ticks). */
  sim: { bid: number; spreadTicks: number; dailyVol: number };
};

export const SYMBOLS: SymbolSpec[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    assetClass: 'stock',
    tickSize: 0.01,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.02,
    minQty: 1,
    qtyStep: 1,
    qtyLabel: 'Shares',
    liveFeed: 'finnhub',
    sim: { bid: 201.56, spreadTicks: 1, dailyVol: 0.018 },
  },
  {
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    exchange: 'NASDAQ',
    assetClass: 'stock',
    tickSize: 0.01,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.02,
    minQty: 1,
    qtyStep: 1,
    qtyLabel: 'Shares',
    liveFeed: 'finnhub',
    sim: { bid: 378.67, spreadTicks: 2, dailyVol: 0.035 },
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    exchange: 'NASDAQ',
    assetClass: 'stock',
    tickSize: 0.01,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.02,
    minQty: 1,
    qtyStep: 1,
    qtyLabel: 'Shares',
    liveFeed: 'finnhub',
    sim: { bid: 182.41, spreadTicks: 1, dailyVol: 0.03 },
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    exchange: 'NASDAQ',
    assetClass: 'stock',
    tickSize: 0.01,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.02,
    minQty: 1,
    qtyStep: 1,
    qtyLabel: 'Shares',
    liveFeed: 'finnhub',
    sim: { bid: 512.3, spreadTicks: 2, dailyVol: 0.015 },
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com, Inc.',
    exchange: 'NASDAQ',
    assetClass: 'stock',
    tickSize: 0.01,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.02,
    minQty: 1,
    qtyStep: 1,
    qtyLabel: 'Shares',
    liveFeed: 'finnhub',
    sim: { bid: 226.12, spreadTicks: 1, dailyVol: 0.02 },
  },
  {
    symbol: 'BTCUSDT',
    name: 'Bitcoin / TetherUS',
    exchange: 'BINANCE',
    assetClass: 'crypto',
    tickSize: 0.01,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.5,
    leverage: 2,
    minQty: 0.00001,
    qtyStep: 0.00001,
    qtyLabel: 'Units',
    liveFeed: 'binance',
    sim: { bid: 84844.0, spreadTicks: 1, dailyVol: 0.03 },
  },
  {
    symbol: 'ETHUSDT',
    name: 'Ethereum / TetherUS',
    exchange: 'BINANCE',
    assetClass: 'crypto',
    tickSize: 0.01,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.5,
    leverage: 2,
    minQty: 0.0001,
    qtyStep: 0.0001,
    qtyLabel: 'Units',
    liveFeed: 'binance',
    sim: { bid: 2680.4, spreadTicks: 1, dailyVol: 0.04 },
  },
  {
    symbol: 'EURUSD',
    name: 'Euro / U.S. Dollar',
    exchange: 'FX',
    assetClass: 'forex',
    tickSize: 0.00001,
    pipSize: 0.0001,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.02,
    leverage: 50,
    minQty: 1000,
    qtyStep: 1000,
    qtyLabel: 'Units',
    liveFeed: 'sim',
    sim: { bid: 1.12481, spreadTicks: 2, dailyVol: 0.005 },
  },
  {
    symbol: 'GBPUSD',
    name: 'British Pound / U.S. Dollar',
    exchange: 'FX',
    assetClass: 'forex',
    tickSize: 0.00001,
    pipSize: 0.0001,
    pointValue: 1,
    currency: 'USD',
    marginRate: 0.02,
    leverage: 50,
    minQty: 1000,
    qtyStep: 1000,
    qtyLabel: 'Units',
    liveFeed: 'sim',
    sim: { bid: 1.32376, spreadTicks: 3, dailyVol: 0.006 },
  },
  {
    symbol: 'USDJPY',
    name: 'U.S. Dollar / Japanese Yen',
    exchange: 'FX',
    assetClass: 'forex',
    tickSize: 0.001,
    pipSize: 0.01,
    pointValue: 1,
    currency: 'JPY',
    marginRate: 0.02,
    leverage: 50,
    minQty: 1000,
    qtyStep: 1000,
    qtyLabel: 'Units',
    liveFeed: 'sim',
    sim: { bid: 157.822, spreadTicks: 3, dailyVol: 0.006 },
  },
];

export const SYMBOL_GROUPS: { title: string; assetClass: AssetClass }[] = [
  { title: 'Stocks', assetClass: 'stock' },
  { title: 'Crypto', assetClass: 'crypto' },
  { title: 'Forex', assetClass: 'forex' },
];

const BY_SYMBOL = new Map(SYMBOLS.map((s) => [s.symbol, s]));

export function getSpec(symbol: string): SymbolSpec {
  const spec = BY_SYMBOL.get(symbol);
  if (!spec) throw new Error(`Unknown symbol ${symbol}`);
  return spec;
}

export function pricePrecision(spec: Pick<SymbolSpec, 'tickSize'>): number {
  return decimalsOf(spec.tickSize);
}

export function qtyPrecision(spec: Pick<SymbolSpec, 'qtyStep'>): number {
  return decimalsOf(spec.qtyStep);
}

function decimalsOf(step: number): number {
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

export const DEFAULT_SYMBOL = 'AAPL';
