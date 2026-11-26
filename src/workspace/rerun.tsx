/*
 * Re-runs after a workflow edit. When the owner changes the workflow of a built app (on the canvas, in a station's
 * Customize tab, or by asking in chat), only the stations that change touches run again. The run waits a few seconds
 * first: every further edit in that time restarts the wait, and the re-run starts from the earliest station any of
 * them touched. That keeps a burst of edits to one run, which protects the model budget in Live.
 *
 * A re-run that would start at the Database station rebuilds the database and replaces its records with the sample
 * rows. That is a big trade-off, so it is not started on its own: the owner is asked first.
 */
import { useEffect, useState } from 'react';
import type { AppRecord } from '@/shared/types/workspace';
import { S, notify, useStore } from './core';
import { PENDING, RUNS, STATIONS } from './line';
import { Btn, Icon, MBar } from './ui';

/** How long the workspace waits after the last workflow edit before it re-runs. */
export const RERUN_DELAY_MS = 5000;
/** How often a re-run that is due checks again while another run or an approval holds the app. */
const BUSY_RETRY_MS = 1000;

/** Starts a re-run from one station. `auto` means nobody pressed a button, so it must not ask about safe re-runs. */
export type RerunStart = (app: AppRecord, stationId: string, auto: boolean) => unknown;

interface Queued {
  /** Index in STATIONS of the earliest station a queued edit touched. */
  from: number;
  /** When the re-run starts, in epoch milliseconds. */
  due: number;
  timer: ReturnType<typeof setTimeout> | null;
  start: RerunStart;
}

const QUEUE: Record<string, Queued> = {};

/** True when a re-run from this station only rebuilds what comes after the data, so records stay. */
export const safeToAutoRun = (from: number) => from >= 2;

function fire(appId: string) {
  const q = QUEUE[appId],
    app = S.apps[appId];
  if (!q) return;
  if (!app || (app.status !== 'ready' && !RUNS[appId])) {
    // the app was deleted, or it is not built any more: nothing to keep, so nothing to re-run
    cancelRerun(appId);
    return;
  }
  if (RUNS[appId] || PENDING[appId]) {
    q.timer = setTimeout(() => fire(appId), BUSY_RETRY_MS);
    return;
  }
  delete QUEUE[appId];
  notify();
  q.start(app, STATIONS[q.from].id, safeToAutoRun(q.from));
}

/**
 * Queues a re-run of an app from one station. Called after each workflow edit that changes what a station makes.
 * A second call before the first one fires restarts the wait and keeps the earlier station of the two.
 */
export function queueRerun(app: AppRecord, from: number, start: RerunStart, delay = RERUN_DELAY_MS) {
  if (!(from >= 0 && from < STATIONS.length)) return;
  const q = QUEUE[app.id];
  if (q?.timer) clearTimeout(q.timer);
  const next: Queued = { from: q ? Math.min(q.from, from) : from, due: Date.now() + delay, timer: null, start };
  next.timer = setTimeout(() => fire(app.id), delay);
  QUEUE[app.id] = next;
  notify();
}

/** The re-run waiting for an app, if there is one. */
export function queuedRerun(appId: string): { from: number; due: number } | null {
  const q = QUEUE[appId];
  return q ? { from: q.from, due: q.due } : null;
}

export function cancelRerun(appId: string) {
  const q = QUEUE[appId];
  if (!q) return;
  if (q.timer) clearTimeout(q.timer);
  delete QUEUE[appId];
  notify();
}

/** Starts the waiting re-run now instead of at the end of the wait. */
export function rerunNow(appId: string) {
  const q = QUEUE[appId];
  if (!q) return;
  if (q.timer) clearTimeout(q.timer);
  q.timer = null;
  fire(appId);
}

function useSecondsLeft(due: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (due == null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [due]);
  return due == null ? 0 : Math.max(0, Math.ceil((due - now) / 1000));
}

/** What the bar says about a waiting re-run, in plain words. */
export function rerunText(from: number, secondsLeft: number, busy: boolean) {
  const again = STATIONS.slice(from).map((s) => s.name),
    list = again.length > 2 ? again.slice(0, -1).join(', ') + ' and ' + again[again.length - 1] : again.join(' and '),
    kept = STATIONS.slice(0, from).map((s) => s.name);
  const when = busy ? 'when the current run ends' : secondsLeft > 0 ? 'in ' + secondsLeft + ' s' : 'now';
  if (!safeToAutoRun(from))
    return (
      'The workflow changed. Running again from ' + STATIONS[from].name + ' rebuilds the database, so I will ask you first, ' + when + '.'
    );
  return (
    'The workflow changed, so ' +
    list +
    (again.length > 1 ? ' run' : ' runs') +
    ' again ' +
    when +
    '. ' +
    kept.join(', ') +
    (kept.length > 1 ? ' stay as they are.' : ' stays as it is.')
  );
}

/** The bar on the Build view and in the chat card while a re-run waits. */
export function RerunBar({ app, compact }: { app: AppRecord; compact?: boolean }) {
  useStore();
  const q = queuedRerun(app.id),
    left = useSecondsLeft(q ? q.due : null);
  if (!q) return null;
  const busy = !!(RUNS[app.id] || PENDING[app.id]),
    actions = (
      <span className="row gap1">
        <Btn className="btn sm primary" disabled={busy} onClick={() => rerunNow(app.id)}>
          <Icon n="rerun" s="16" />
          Run now
        </Btn>
        <Btn className="btn sm subtle" onClick={() => cancelRerun(app.id)}>
          Do not run again
        </Btn>
      </span>
    );
  if (compact)
    return (
      <div className="col gap1 rerun-wait" role="status">
        <span className="t-cap">{rerunText(q.from, left, busy)}</span>
        {actions}
      </div>
    );
  return (
    <div className="rerun-wait">
      <MBar tone="info" action={actions}>
        {rerunText(q.from, left, busy)}
      </MBar>
    </div>
  );
}
