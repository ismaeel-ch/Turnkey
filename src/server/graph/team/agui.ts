/**
 * The bridge to the AG-UI stream layer (src/server/agui, WP-08).
 *
 * `teamWork` is the function `graphAgent()` takes: it reads the run request from `sink.input.forwardedProps`, runs the
 * team and passes every event on through the sink. The sink type below is the part of WP-08's `AgentSink` this uses.
 * Joining is one line, where `createTeamAgent` should return a GraphAgent:
 *
 *   export const createTeamAgent = () => graphAgent(teamWork(options), { description: 'An app's own agent team' });
 */
import { runTeamGraph } from './run';
import type { TeamContext } from './graph';
import type { EventSink, TeamEvent } from './types';

export interface AgentSinkLike {
  readonly input: { forwardedProps?: unknown };
  readonly signal: AbortSignal;
  step(name: string): void;
  endStep(): void;
  text(delta: string, opts?: { messageId?: string }): void;
  endText(): void;
  toolCall(name: string, args?: unknown, opts?: { id?: string }): string;
  toolResult(toolCallId: string, result: unknown): void;
  state(delta: { op: 'add' | 'replace'; path: string; value?: unknown }[]): void;
  custom(name: string, value: unknown): void;
  finish(result?: unknown): void;
  fail(code: string, message: string): void;
}

/** Passes a run's events on to an AG-UI sink. RUN_STARTED is left out: the stream layer sends it itself. */
export function eventSinkOver(sink: AgentSinkLike): EventSink {
  const tools = new Map<string, { name: string; args: string }>();
  return {
    emit(e: TeamEvent) {
      switch (e.type) {
        case 'STEP_STARTED':
          return sink.step(e.stepName);
        case 'STEP_FINISHED':
          return sink.endStep();
        case 'TEXT_MESSAGE_CONTENT':
          return sink.text(e.delta, { messageId: e.messageId });
        case 'TEXT_MESSAGE_END':
          return sink.endText();
        case 'TOOL_CALL_START':
          tools.set(e.toolCallId, { name: e.toolCallName, args: '' });
          return;
        case 'TOOL_CALL_ARGS': {
          const t = tools.get(e.toolCallId);
          if (t) t.args += e.delta;
          return;
        }
        case 'TOOL_CALL_END': {
          const t = tools.get(e.toolCallId);
          if (t) sink.toolCall(t.name, t.args, { id: e.toolCallId });
          return;
        }
        case 'TOOL_CALL_RESULT':
          return sink.toolResult(e.toolCallId, e.content);
        case 'STATE_DELTA':
          return sink.state(e.delta);
        case 'CUSTOM':
          return sink.custom(e.name, e.value);
        case 'RUN_FINISHED':
          return sink.finish(e.result);
        case 'RUN_ERROR':
          return sink.fail(e.code ?? 'failed', e.message);
        default:
          return;
      }
    },
  };
}

export const teamWork = (base: Omit<TeamContext, 'sink' | 'signal'>) => async (sink: AgentSinkLike) => {
  await runTeamGraph(sink.input.forwardedProps, { ...base, sink: eventSinkOver(sink), signal: sink.signal });
};
