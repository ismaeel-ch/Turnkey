import { STEP_AGENT_ID, type StepAgent, type StepError, type StepEvent, type StepInput, type StepResult } from '@/shared/agent-contract';
import { createStepGraph, type StepGraphOptions } from './graph';

export { createStepGraph } from './graph';

/** The agent for the runtime registry. agui-stream wraps `run` in its AG-UI agent class; tests call it directly. */
export function createStepAgent(options: StepGraphOptions = {}): StepAgent {
  const graph = createStepGraph(options);
  return {
    id: STEP_AGENT_ID,
    async run(input: StepInput, { sink, signal }: { sink?: (e: StepEvent) => void; signal?: AbortSignal } = {}) {
      let ended = false; // exactly one result or error event per run, even when LangGraph itself throws
      const emit = (e: StepEvent) => {
        if (e.type === 'result' || e.type === 'error') ended = true;
        sink?.(e);
      };
      const stop = (error: StepError) => {
        if (!ended) emit({ type: 'error', error });
        return { error };
      };
      try {
        const out = await graph.invoke({ input }, { signal, configurable: { sink: emit } });
        if (out.result) {
          emit({ type: 'result', result: out.result as StepResult });
          return { result: out.result as StepResult };
        }
        return stop(out.error ?? { code: 'upstream', message: 'The step ended without an answer.', attempts: out.attempt, issues: [] });
      } catch (e) {
        if (signal?.aborted) return stop({ code: 'aborted', message: 'The request was cancelled.', attempts: 0, issues: [] });
        return stop({
          code: 'upstream',
          message: 'The step failed: ' + (e instanceof Error ? e.message : 'unknown error'),
          attempts: 0,
          issues: [],
        });
      }
    },
  };
}
