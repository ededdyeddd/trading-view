import { Bug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { clearEvents, exportEventsJson, getEvents, onEventsChange } from '../analytics/eventLog';
import { DEBUG, FEED_MODE } from '../config/flags';
import { dropLiveFeeds, setSimWalk, useMarketStore } from '../market/marketStore';
import { useTradingStore } from '../store/tradingStore';
import { useVariantStore } from '../store/variantStore';
import styles from './DebugMenu.module.css';

/** Hidden test-moderator menu (?debug=1): event log export, time travel, account reset. */
export function DebugMenu() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(() => getEvents().length);
  const clockOffset = useTradingStore((s) => s.clockOffset);
  const advanceClock = useTradingStore((s) => s.advanceClock);
  const resetAccount = useTradingStore((s) => s.resetAccount);
  const variant = useVariantStore((s) => s.variant);
  const simWalk = useMarketStore((s) => s.simWalk);

  useEffect(() => onEventsChange(() => setCount(getEvents().length)), []);

  if (!DEBUG) return null;

  const download = () => {
    const blob = new Blob([exportEventsJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-events-${variant}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.root}>
      {open && (
        <div className={styles.menu} data-testid="debug-menu">
          <div className={styles.title}>Debug</div>
          <div className={styles.meta}>
            panel: <b>{variant}</b> · feed: <b>{FEED_MODE}</b>
          </div>
          <div className={styles.meta}>
            logged events: <b>{count}</b>
            {clockOffset > 0 && <> · clock +{Math.round(clockOffset / 3_600_000)}h</>}
          </div>
          <button type="button" onClick={download} data-testid="export-events">
            Export events JSON
          </button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(exportEventsJson())}>
            Copy events JSON
          </button>
          <button type="button" onClick={clearEvents}>
            Clear events
          </button>
          <hr />
          <label className={styles.meta}>
            <input
              type="checkbox"
              checked={simWalk === 'volatile'}
              onChange={(e) => setSimWalk(e.target.checked ? 'volatile' : 'gauss')}
              data-testid="sim-volatile"
            />{' '}
            Volatile (sim: ±20 ticks / 200 ms)
          </label>
          <button type="button" onClick={dropLiveFeeds} data-testid="drop-feeds">
            Drop live feeds (fallback to sim)
          </button>
          <button type="button" onClick={() => advanceClock(86_400_000)} data-testid="advance-day">
            Advance clock +1 day (expire orders)
          </button>
          <button type="button" onClick={() => advanceClock(7 * 86_400_000)}>
            Advance clock +7 days
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Reset paper trading account?')) resetAccount();
            }}
          >
            Reset account
          </button>
        </div>
      )}
      <button type="button" className={styles.fab} onClick={() => setOpen((v) => !v)} aria-label="Debug menu" data-testid="debug-toggle">
        <Bug size={16} />
      </button>
    </div>
  );
}
