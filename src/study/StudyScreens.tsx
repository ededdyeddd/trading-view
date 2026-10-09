import { useEffect, useState } from 'react';
import { STUDY_PID, STUDY_SCENARIO, PANEL_VARIANT, type PanelVariant } from '../config/flags';
import { useTradingStore } from '../store/tradingStore';
import { SCENARIOS, getScenario, type ScenarioId } from './scenarios';
import {
  attachRun,
  buildPlan,
  clearSession,
  download,
  finishRun,
  loadSession,
  runUrl,
  saveSession,
  sessionCsv,
  sessionJson,
  type Run,
  type Session,
} from './studyStore';
import styles from './Study.module.css';

/** `?study=1` — participant ID, panel (or random order), scenarios. */
export function StudySetup() {
  const [pid, setPid] = useState('');
  const [panel, setPanel] = useState<PanelVariant | 'random'>('random');
  const [picked, setPicked] = useState<ScenarioId[]>(SCENARIOS.map((s) => s.id));
  const existing = loadSession();

  const start = () => {
    const plan = buildPlan(panel, picked);
    const session: Session = { pid: pid.trim(), createdAt: Date.now(), plan, index: 0, runs: [] };
    saveSession(session);
    location.href = runUrl(session.pid, plan[0]);
  };

  return (
    <div className={styles.setup}>
      <div className={styles.card}>
        <h1>Order panel study</h1>
        <label className={styles.row}>
          <span>Participant ID</span>
          <input value={pid} onChange={(e) => setPid(e.target.value)} placeholder="P01" autoFocus data-testid="study-pid" />
        </label>
        <fieldset className={styles.row}>
          <legend>Panel</legend>
          {(['random', 'current', 'new'] as const).map((p) => (
            <label key={p} className={styles.choice}>
              <input type="radio" name="panel" checked={panel === p} onChange={() => setPanel(p)} data-testid={`study-panel-${p}`} />
              {p === 'random' ? 'Both, random order' : p === 'current' ? 'Current (control)' : 'New (redesign)'}
            </label>
          ))}
        </fieldset>
        <fieldset className={styles.row}>
          <legend>Scenarios</legend>
          {SCENARIOS.map((s) => (
            <label key={s.id} className={styles.choice}>
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id].sort() : p.filter((x) => x !== s.id)))}
              />
              {s.id}. {s.task}
            </label>
          ))}
        </fieldset>
        <button type="button" className={styles.primary} disabled={!pid.trim() || picked.length === 0} onClick={start} data-testid="study-start">
          Start
        </button>
        {existing && existing.runs.length > 0 && (
          <p className={styles.note}>
            Previous session: {existing.pid}, {existing.runs.filter((r) => r.doneAt).length}/{existing.plan.length} done.{' '}
            <a href={`?study=done&pid=${encodeURIComponent(existing.pid)}`}>Results</a>
          </p>
        )}
      </div>
    </div>
  );
}

function fmtMs(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`;
}

/** The task strip above the interface during a run. */
export function StudyBar() {
  const [session] = useState(() => loadSession());
  const [run, setRun] = useState<Run | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const valid =
    !!session && session.pid === STUDY_PID && session.plan[session.index]?.scenario === STUDY_SCENARIO && session.plan[session.index]?.panel === PANEL_VARIANT;

  useEffect(() => {
    if (!session || !valid) return;
    // A new run starts from a clean paper account.
    if (!session.runs[session.index]) useTradingStore.getState().resetAccount();
    return attachRun(session, setRun);
  }, [session, valid]);

  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => setElapsed(Date.now() - run.startedAt), 250);
    return () => clearInterval(id);
  }, [run]);

  if (!session || !valid) {
    return (
      <div className={styles.bar} data-testid="study-bar">
        <span>No active study run for these URL parameters.</span>
        <a href="?study=1">Start a study</a>
      </div>
    );
  }
  const scenario = getScenario(STUDY_SCENARIO)!;
  return (
    <div className={styles.bar} data-testid="study-bar">
      <span className={styles.step}>
        {session.index + 1}/{session.plan.length}
      </span>
      <span className={styles.task} data-testid="study-task">
        {scenario.task}
      </span>
      <span className={styles.meta}>
        {fmtMs(elapsed)} · submits {run?.submits ?? 0}
      </span>
      <button type="button" className={styles.done} onClick={() => (location.href = finishRun(session))} data-testid="study-done">
        Done
      </button>
    </div>
  );
}

/** `?study=done` — results table and export. */
export function StudyDone() {
  const [session, setSession] = useState(() => loadSession());
  if (!session) {
    return (
      <div className={styles.setup}>
        <div className={styles.card}>
          <p>No study session.</p>
          <a href="?study=1">Start</a>
        </div>
      </div>
    );
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return (
    <div className={styles.setup}>
      <div className={`${styles.card} ${styles.wide}`}>
        <h1>Results · {session.pid}</h1>
        <table className={styles.table} data-testid="study-results">
          <thead>
            <tr>
              <th>#</th>
              <th>Panel</th>
              <th>Scenario</th>
              <th>Correct</th>
              <th>Open → submit</th>
              <th>Validation errors</th>
              <th>Cancels</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {session.runs.map((r, i) => (
              <tr key={i} data-testid={`study-row-${i}`}>
                <td>{i + 1}</td>
                <td>{r.panel}</td>
                <td>{r.scenario}</td>
                <td className={r.result?.pass ? styles.ok : styles.bad}>{r.result ? (r.result.pass ? 'yes' : 'no') : '—'}</td>
                <td>{fmtMs(r.msOpenToSubmit)}</td>
                <td>{r.validationErrors}</td>
                <td>{r.cancels}</td>
                <td>{r.result?.mismatches.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => download(`study-${session.pid}-${stamp}.json`, sessionJson(session), 'application/json')}
            data-testid="study-export-json"
          >
            Export JSON
          </button>
          <button type="button" onClick={() => download(`study-${session.pid}-${stamp}.csv`, sessionCsv(session), 'text/csv')} data-testid="study-export-csv">
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Clear this study session?')) {
                clearSession();
                setSession(null);
              }
            }}
          >
            Clear session
          </button>
          <a href="?study=1">New participant</a>
        </div>
      </div>
    </div>
  );
}
