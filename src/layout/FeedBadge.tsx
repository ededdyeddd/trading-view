import { useMarketStore } from '../market/marketStore';

/** "Simulated data" badge: shown when the current symbol's live feed dropped and sim took over. */
export function FeedBadge({ symbol }: { symbol: string }) {
  const status = useMarketStore((s) => s.status[symbol]);
  if (!status?.fellBack) return null;
  return (
    <span
      title={`Live feed (${status.configured}) unavailable: ${status.reason ?? 'unknown'}. Showing simulated prices.`}
      style={{
        fontSize: 11,
        lineHeight: '18px',
        padding: '0 8px',
        borderRadius: 9,
        background: 'var(--color-bg-hover)',
        color: 'var(--color-orange)',
        border: '1px solid currentColor',
        whiteSpace: 'nowrap',
        marginRight: 6,
      }}
      data-testid="sim-badge"
    >
      Simulated data
    </span>
  );
}
