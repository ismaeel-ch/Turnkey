import { STATIONS } from './default-workflow';
import type { StepDef, WorkflowDefinition } from './types';

/**
 * The part of the workspace's workflow object (`flowOf(app)` in `src/workspace/custom.tsx`) that the graph needs.
 * It is described here, not imported, so this library does not depend on the workspace.
 */
export interface FlowLike {
  attempts: number;
  approve: Record<string, boolean>;
  by: Record<string, string>;
  /** Added step ids, already sorted the way `normFlow` sorts them. */
  reviewers: string[];
  at: Record<string, string>;
  auto: Record<string, boolean>;
}

/** What the workspace knows about one step id (an entry of `REVIEWERS`). */
export interface StepInfo {
  name: string;
  /** The station it follows when `flow.at` does not move it. */
  after: string;
  /** Applies its changes by default. */
  auto?: boolean;
  custom?: boolean;
}

/**
 * Build the definition of a run from the owner's workflow. Wire it with the workspace's own helpers:
 *
 *   import { flowOf, REVIEWERS } from '@/workspace/custom';
 *   const def = workflowFromFlow(flowOf(app), (id) => REVIEWERS[id], from);
 */
export function workflowFromFlow(flow: FlowLike, info: (id: string) => StepInfo | undefined, from?: string): WorkflowDefinition {
  const steps: StepDef[] = [];
  for (const id of flow.reviewers) {
    const s = info(id);
    if (!s) continue;
    const after = (flow.at && flow.at[id]) || s.after;
    const auto = flow.auto && id in flow.auto ? !!flow.auto[id] : !!s.auto;
    steps.push({ id, name: s.name, after, mode: auto ? 'apply' : 'advise', ...(s.custom ? { custom: true } : {}) });
  }
  const attempts = Math.round(Number(flow.attempts));
  return {
    stations: STATIONS.map((s) => ({ ...s, byRules: flow.by && flow.by[s.id] === 'rules' ? true : undefined })),
    attempts: attempts >= 1 && attempts <= 3 ? attempts : 3,
    approvals: STATIONS.filter((s) => flow.approve && flow.approve[s.id]).map((s) => s.id),
    steps,
    ...(from ? { from } : {}),
    testerRounds: 3,
  };
}
