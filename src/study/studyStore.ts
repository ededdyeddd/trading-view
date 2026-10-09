/**
 * Usability study session: participant plan, per-run metrics and export. Persisted in localStorage
 * so a run survives the page navigation between scenarios.
 */
import { onEventsChange, getEvents, type LoggedEvent } from '../analytics/eventLog';
import type { PanelVariant } from '../config/flags';
import type { OrderDraft } from '../engine/types';
import { checkDraft, getScenario, type CheckResult, type Market, type ScenarioId } from './scenarios';

const KEY = 'study:v1';

export type PlanItem = { panel: PanelVariant; scenario: ScenarioId };

export type Run = PlanItem & {
  pid: string;
  seed: number;
  startedAt: number;
  firstOpenAt: number | null;
  submittedAt: number | null;
  doneAt: number | null;
  /** Ticket open → last submit, from the event log. */
  msOpenToSubmit: number | null;
  /** Run start → last submit. */
  msStartToSubmit: number | null;
  submits: number;
  validationErrors: number;
  cancels: number;
  lastDraft: OrderDraft | null;
  lastMarket: Market | null;
  result: CheckResult | null;
};

export type Session = { pid: string; createdAt: number; plan: PlanItem[]; index: number; runs: Run[] };

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — the run still works, export from memory */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** current / new / random order (AB or BA, each panel runs every selected scenario). */
export function buildPlan(choice: PanelVariant | 'random', scenarios: ScenarioId[], rand = Math.random): PlanItem[] {
  const panels: PanelVariant[] = choice === 'random' ? (rand() < 0.5 ? ['current', 'new'] : ['new', 'current']) : [choice];
  return panels.flatMap((panel) => scenarios.map((scenario) => ({ panel, scenario })));
}

export function runUrl(pid: string, item: PlanItem): string {
  const sc = getScenario(item.scenario)!;
  const q = new URLSearchParams({ study: 'run', pid, panel: item.panel, scenario: String(item.scenario), seed: String(sc.seed), chartLines: '1' });
  return `${location.pathname}?${q.toString()}`;
}

export function doneUrl(pid: string): string {
  return `${location.pathname}?study=done&pid=${encodeURIComponent(pid)}`;
}

/** Starts (or resumes) the current run and keeps its metrics updated from the ticket event log. */
export function attachRun(session: Session, onChange: (run: Run) => void): () => void {
  const item = session.plan[session.index];
  let run = session.runs[session.index];
  if (!run || run.panel !== item.panel || run.scenario !== item.scenario) {
    run = {
      ...item,
      pid: session.pid,
      seed: getScenario(item.scenario)!.seed,
      startedAt: Date.now(),
      firstOpenAt: null,
      submittedAt: null,
      doneAt: null,
      msOpenToSubmit: null,
      msStartToSubmit: null,
      submits: 0,
      validationErrors: 0,
      cancels: 0,
      lastDraft: null,
      lastMarket: null,
      result: null,
    };
    session.runs[session.index] = run;
    saveSession(session);
  }
  const startedAt = run.startedAt;
  const recompute = () => {
    const evs = getEvents().filter((e) => e.t >= startedAt);
    const next = summarize(run, evs);
    session.runs[session.index] = next;
    run = next;
    saveSession(session);
    onChange(next);
  };
  recompute();
  return onEventsChange(recompute);
}

function summarize(run: Run, evs: LoggedEvent[]): Run {
  const submits = evs.filter((e) => e.type === 'submit');
  const last = submits[submits.length - 1];
  const open = evs.find((e) => e.type === 'ticket_open');
  const rejected = evs.filter((e) => e.type === 'submit_result' && e.data?.result === 'rejected').length;
  return {
    ...run,
    firstOpenAt: open?.t ?? run.firstOpenAt,
    submittedAt: last?.t ?? null,
    msOpenToSubmit: (last?.data?.msFromOpen as number | undefined) ?? null,
    msStartToSubmit: last ? last.t - run.startedAt : null,
    submits: submits.length,
    validationErrors: evs.filter((e) => e.type === 'validation_error').length + rejected,
    cancels: evs.filter((e) => e.type === 'order_cancel' || e.type === 'position_close').length,
    lastDraft: (last?.data?.draft as OrderDraft | undefined) ?? null,
    lastMarket: (last?.data?.market as Market | undefined) ?? null,
  };
}

/** "Done": auto-check the last submitted draft and move on. Returns the next URL. */
export function finishRun(session: Session): string {
  const run = session.runs[session.index];
  const sc = getScenario(run.scenario)!;
  session.runs[session.index] = { ...run, doneAt: Date.now(), result: checkDraft(run.lastDraft, sc, run.lastMarket ?? { bid: 0, ask: 0 }) };
  session.index += 1;
  saveSession(session);
  return session.index < session.plan.length ? runUrl(session.pid, session.plan[session.index]) : doneUrl(session.pid);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  'pid',
  'panel',
  'scenario',
  'pass',
  'mismatches',
  'ms_open_to_submit',
  'ms_start_to_submit',
  'submits',
  'validation_errors',
  'cancels',
  'side',
  'type',
  'qty',
  'price',
  'stop_loss',
  'take_profit',
  'tif',
  'started_at',
  'done_at',
] as const;

function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sessionCsv(s: Session): string {
  const rows = s.runs.map((r) => {
    const d = r.lastDraft;
    return [
      r.pid,
      r.panel,
      r.scenario,
      r.result ? (r.result.pass ? 'yes' : 'no') : '',
      r.result?.mismatches.join('; ') ?? '',
      r.msOpenToSubmit,
      r.msStartToSubmit,
      r.submits,
      r.validationErrors,
      r.cancels,
      d?.side,
      d?.type,
      d?.qty,
      d?.limitPrice ?? d?.stopPrice,
      d?.stopLoss,
      d?.takeProfit ?? d?.takeProfits?.map((t) => `${t.price}x${t.qty}`).join(' '),
      d?.tif,
      new Date(r.startedAt).toISOString(),
      r.doneAt ? new Date(r.doneAt).toISOString() : '',
    ]
      .map(cell)
      .join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}

export function sessionJson(s: Session): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), ...s, events: getEvents() }, null, 2);
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
