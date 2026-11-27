/*
 * Agent activity: a panel that shows which agent is working, on what step, which tools it called, who handed work
 * to whom, and which checks sent work back. It reads AG-UI events: the workspace's own log (EV) and, through the
 * bus in src/platform/agui/activity.ts, the events of agents that run on the server. A second tab, "How it works",
 * draws the build team and the workflow this app runs on, plus the app's own agent team when it has one.
 */
import { deriveActivity } from '@/platform/agui/activity';
import type { ActivityItem, ActivityModel, RawAgentEvent } from '@/platform/agui/activity';
import type { Dict } from '@/shared/types/workspace';
import { EV, cap } from './core';
import { STATIONS } from './line';
import { REVIEWERS } from './reviewers';

/** The agent a step belongs to, when the event does not name one. */
export function agentOfEvent(e: RawAgentEvent | null | undefined): string | null {
  const s = e && e.stepName;
  if (typeof s !== 'string') return null;
  const st = STATIONS.find((x) => x.id === s);
  if (st) return st.agent;
  if (s === 'tests') return 'tester';
  if (s.startsWith('review_')) return 'rv_' + s.slice(7);
  return null;
}

/* ---------- the model, from the events ---------- */

let cache: { key: string; model: ActivityModel | null } = { key: '', model: null };
/** The activity of one app (or of every app with no id), derived from the event log. */
export function activityNow(appId?: string | null): ActivityModel {
  const last = EV.length ? EV[EV.length - 1].seq : 0;
  const key = (appId || '*') + ':' + EV.length + ':' + last;
  let model = cache.model;
  if (cache.key !== key || !model) {
    model = deriveActivity(EV, { agentOf: agentOfEvent, app: appId || null });
    cache = { key, model };
  }
  return model;
}

/* ---------- words ---------- */

const STEP_WORDS: Dict<string> = {
  guard: 'checking the request',
  draft: 'writing a draft',
  validate: 'checking the draft',
  repair: 'fixing the draft',
  finish: 'finishing',
};
export type StepRef = Pick<ActivityItem, 'step' | 'server'>;
export const stepName = (it: StepRef): string => {
  if (!it.step) return 'a step';
  if (it.server) return STEP_WORDS[it.step] || it.step;
  const st = STATIONS.find((x) => x.id === it.step);
  if (st) return st.name;
  if (it.step === 'tests') return 'Tests';
  if (it.step.startsWith('review_')) return REVIEWERS[it.step.slice(7)]?.short || 'a review';
  return cap(it.step.replace(/_/g, ' '));
};

/* ---------- the panel ---------- */

/** The panel listens here so a shortcut or the command palette can open and close it. */
export const panelToggles = new Set<() => void>();
export function toggleAgentsPanel() {
  panelToggles.forEach((f) => f());
}
