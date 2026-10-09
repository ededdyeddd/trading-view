import { Bug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { clearEvents, exportEventsJson, getEvents, onEventsChange } from '../analytics/eventLog';
import { DEBUG, FEED_MODE, PANEL_VARIANT } from '../config/flags';
import { dropLiveFeeds } from '../market/marketStore';
import { download as downloadFile, loadSession, sessionCsv, sessionJson } from '../study/studyStore';
import { useTradingStore } from '../store/tradingStore';
import styles from './DebugMenu.module.css';

/** Hidden test-moderator menu (?debug=1): event log export, time travel, account reset. */
export function DebugMenu() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(() => getEvents().length);
  const clockOffset = useTradingStore((s) => s.clockOffset);
  const advanceClock = useTradingStore((s) => s.advanceClock);
  const resetAccount = useTradingStore((s) => s.resetAccount);

  useEffect(() => onEventsChange(() => setCount(getEvents().length)), []);

  if (!DEBUG) return null;

  const download = () => {
    const blob = new Blob([exportEventsJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-events-${PANEL_VARIANT}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.root}>
      {open && (
        <div className={styles.menu} data-testid="debug-menu">
          <div className={styles.title}>Debug</div>
          <div className={styles.meta}>
            panel: <b>{PANEL_VARIANT}</b> · feed: <b>{FEED_MODE}</b>
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
          <button
            type="button"
            onClick={() => {
              const s = loadSession();
              if (s) downloadFile(`study-${s.pid}.json`, sessionJson(s), 'application/json');
            }}
            data-testid="export-study-json"
          >
            Export study JSON (participant)
          </button>
          <button
            type="button"
            onClick={() => {
              const s = loadSession();
              if (s) downloadFile(`study-${s.pid}.csv`, sessionCsv(s), 'text/csv');
            }}
            data-testid="export-study-csv"
          >
            Export study CSV (participant)
          </button>
          <hr />
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
