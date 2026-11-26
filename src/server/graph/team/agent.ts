/**
 * The team agent, for the runtime registry (agent id `team`). Server only.
 *
 * The stream layer (agui-stream) turns the events a run emits into the AG-UI response. Until that is joined, this
 * returns an object with one method that takes a request and an event sink, and `src/app/api/agent/team/route.ts`
 * streams the events itself. Tools default to the public-data connectors (src/server/connectors).
 */
import { getConnector } from '../../connectors';
import { resolveProvider, type Provider } from '../../llm';
import { toolBoxFromConnectors } from './connector-tools';
import type { TeamContext } from './graph';
import { runTeamGraph, type TeamResult } from './run';
import type { ToolBox } from './tools';
import type { EventSink } from './types';

export type TeamAgentOptions = { provider?: Provider | null; tools?: ToolBox; beforeModelCall?: () => void; now?: () => number };

export interface TeamAgent {
  readonly id: 'team';
  run(request: unknown, sink: EventSink, signal?: AbortSignal): Promise<TeamResult>;
}

export function createTeamAgent(options: TeamAgentOptions = {}): TeamAgent {
  return {
    id: 'team',
    async run(request, sink, signal) {
      const provider = options.provider === undefined ? resolveProvider() : options.provider;
      if (!provider) {
        const runId = 'run_' + Date.now().toString(36);
        sink.emit({ type: 'RUN_STARTED', threadId: runId, runId });
        sink.emit({ type: 'RUN_ERROR', message: 'No model is configured on this deployment.', code: 'not_configured' });
        return { status: 'failed', reason: 'not_configured', outputs: {}, steps: 0, modelCalls: 0 };
      }
      const ctx: TeamContext = {
        provider,
        tools: options.tools ?? toolBoxFromConnectors(getConnector),
        sink,
        signal,
        beforeModelCall: options.beforeModelCall,
        now: options.now,
      };
      return runTeamGraph(request, ctx);
    },
  };
}
