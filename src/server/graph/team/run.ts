/**
 * Runs one team, start to finish, in one request. Server only.
 *
 * Whatever happens, the run ends with exactly one final event: RUN_FINISHED (done, paused, capped, stopped) or
 * RUN_ERROR (failed). A pause ends the request; the event carries a snapshot, and a second request with that
 * snapshot and the person's note carries on from the same place.
 */
import { Command } from '@langchain/langgraph';
import { LlmError } from '../../llm';
import { errorText, log } from '../../log';
import { checkTeamPolicy } from './policy';
import { Budget, buildTeamGraph, nodeNames, RunFailure, type TeamContext, type TeamState } from './graph';
import { TeamRequestSchema, type AgentOutput, type Snapshot, type TeamRequest, type TeamStatus } from './types';

export type TeamResult = {
  status: TeamStatus;
  reason?: string;
  outputs: Record<string, AgentOutput>;
  snapshot?: Snapshot;
  steps: number;
  modelCalls: number;
};

const plain = (e: unknown): { message: string; code: string } => {
  if (e instanceof RunFailure) return { message: e.message, code: e.code };
  if (e instanceof LlmError) return { message: e.message, code: e.code };
  return { message: 'The team could not finish this run.', code: 'failed' };
};

export async function runTeamGraph(input: TeamRequest | unknown, ctx: TeamContext): Promise<TeamResult> {
  const parsed = TeamRequestSchema.safeParse(input);
  const runId = (parsed.success && parsed.data.runId) || 'run_' + Date.now().toString(36);
  if (!parsed.success) {
    ctx.sink.emit({ type: 'RUN_STARTED', threadId: runId, runId });
    ctx.sink.emit({
      type: 'RUN_ERROR',
      message: 'The team definition is not valid: ' + parsed.error.issues[0]?.path.join('.'),
      code: 'bad_request',
    });
    return { status: 'failed', reason: 'bad_request', outputs: {}, steps: 0, modelCalls: 0 };
  }
  const req = parsed.data;
  const policy = checkTeamPolicy(req);
  if (!policy.ok) {
    ctx.sink.emit({ type: 'RUN_STARTED', threadId: runId, runId });
    ctx.sink.emit({ type: 'RUN_ERROR', message: 'The team definition was refused: ' + policy.message, code: 'bad_request' });
    return { status: 'failed', reason: 'bad_request', outputs: {}, steps: 0, modelCalls: 0 };
  }
  const sink = ctx.sink;
  const budget = new Budget(req.limits, ctx.now, req.resume?.snapshot.used);
  const names = req.team.agents.map((a) => a.id);
  if (req.team.pause && !names.includes(req.team.pause.before)) req.team.pause = null;

  sink.emit({ type: 'RUN_STARTED', threadId: runId, runId });
  const finish = (
    status: TeamStatus,
    reason: string | undefined,
    outputs: Record<string, AgentOutput>,
    snapshot?: Snapshot,
  ): TeamResult => {
    sink.emit({ type: 'RUN_FINISHED', threadId: runId, runId, result: { status, ...(reason ? { reason } : {}) } });
    return { status, reason, outputs, snapshot, steps: budget.steps, modelCalls: budget.calls };
  };

  try {
    const graph = buildTeamGraph(req, ctx, budget);
    const config = { configurable: { thread_id: runId }, recursionLimit: budget.limits.maxSteps * 3 + 10 };
    let out: Record<string, unknown>;
    if (req.resume) {
      const { snapshot, note } = req.resume;
      await graph.updateState(config, snapshot.values, snapshot.asNode);
      sink.emit({ type: 'CUSTOM', name: 'resume', value: { added: note?.text ? 1 : 0 } });
      out = await graph.invoke(new Command({ resume: note ?? { who: '', text: '' } }), config);
    } else {
      out = await graph.invoke({ stopped: '' }, config);
    }
    const state = (await graph.getState(config)).values as TeamState;

    if (out.__interrupt__) {
      const before = req.team.pause?.before ?? '';
      const at = names.indexOf(before);
      const snapshot: Snapshot = {
        values: JSON.parse(JSON.stringify(state)),
        asNode: at > 0 ? nodeNames(names[at - 1]).check : '__start__',
        used: { steps: budget.steps, calls: budget.calls },
      };
      sink.emit({ type: 'CUSTOM', name: 'interrupt', value: { reason: 'jump_in', before, text: req.team.pause?.text ?? '', snapshot } });
      return finish('paused', undefined, state.outputs, snapshot);
    }
    if (state.stopped) {
      sink.emit({ type: 'CUSTOM', name: 'cap', value: { reason: state.stopped, done: Object.keys(state.outputs) } });
      return finish('capped', state.stopped, state.outputs);
    }
    return finish('done', undefined, state.outputs);
  } catch (e) {
    if (ctx.signal?.aborted) return finish('stopped', 'The run was stopped.', {});
    const { message, code } = plain(e);
    if (code === 'failed') log('error', 'team_failed', { error: errorText(e) });
    sink.emit({ type: 'RUN_ERROR', message, code });
    return { status: 'failed', reason: message, outputs: {}, steps: budget.steps, modelCalls: budget.calls };
  }
}
