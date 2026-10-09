import type { CSSProperties } from 'react';

const COLORS: Record<string, string> = {
  AAPL: '#2e2e2e',
  TSLA: '#e31937',
  NVDA: '#76b900',
  MSFT: '#00a4ef',
  AMZN: '#ff9900',
  BTCUSDT: '#f7931a',
  ETHUSDT: '#627eea',
  EURUSD: '#1f4e9e',
  GBPUSD: '#c8102e',
  USDJPY: '#3c3b6e',
};

/** Neutral generated logo (initial in a colored circle) — no third-party brand assets. */
export function SymbolLogo({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: COLORS[symbol] ?? '#707070',
    color: '#fff',
    fontSize: Math.round(size * 0.55),
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    lineHeight: 1,
  };
  return <span style={style}>{symbol[0]}</span>;
}
