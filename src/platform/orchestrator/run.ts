import { Command } from '@langchain/langgraph/web';
import { compileWorkflow } from './compile';
import type { CompiledWorkflow, WorkflowStateType } from './compile';
import { StoppedError } from './types';
import type { AskRequest, Ports, RunOptions, RunResult, WorkflowDefinition } from './types';

const LIMIT = 400; // LangGraph stops a runaway graph after this many steps; every loop here is capped well below it

export interface WorkflowRun {
  /** Start the run. Resolves when it finishes, fails, is stopped, or waits for the owner. */
  start(): Promise<RunResult>;
  /** Answer what the run is waiting for: an option index for a question, true or false for an approval. */
  resume(answer: number | boolean): Promise<RunResult>;
  /** Stop the run, also while it waits for the owner. */
  stop(): void;
  readonly waiting: AskRequest | null;
  readonly graph: CompiledWorkflow;
}

/** Compile the definition and drive it: start, wait for the owner, resume, stop. Emits the run-level events. */
export function createRun(def: WorkflowDefinition, ports: Ports, opts: RunOptions = {}): WorkflowRun {
  let stopRequested = false;
  const ctl = new AbortController();
  const wrapped: Ports = { ...ports, stopped: () => stopRequested || !!ports.stopped?.() };
  const graph = compileWorkflow(def, wrapped, opts);
  const cfg = { configurable: { thread_id: opts.threadId ?? opts.runId ?? 'run' }, recursionLimit: LIMIT, signal: ctl.signal };
  const extra = { ...(opts.runId ? { runId: opts.runId } : {}), ...(opts.app ? { app: opts.app } : {}) };
  let waiting: AskRequest | null = null;
  let started = false;
  let finished = false;

  const summary = (
    v: Partial<WorkflowStateType> | undefined,
    status: RunResult['status'],
    reason?: string,
    ask?: AskRequest,
  ): RunResult => ({
    status,
    reason: reason || undefined,
    ask,
    retries: v?.retries ?? 0,
    qa: v?.qa === 'ok' || v?.qa === 'failed' ? v.qa : undefined,
    rounds: v?.rounds ?? [],
    trail: v?.trail ?? [],
  });

  const finish = async (status: 'ok' | 'failed' | 'stopped', reason?: string): Promise<RunResult> => {
    finished = true;
    waiting = null;
    if (status === 'failed') ports.emit('RUN_ERROR', { ...extra, message: reason ?? 'The build failed.' });
    ports.emit('RUN_FINISHED', { ...extra, status });
    let values: WorkflowStateType | undefined;
    try {
      values = (await graph.getState(cfg)).values;
    } catch {
      values = undefined;
    }
    return summary(values, status, reason);
  };

  const settle = async (output: WorkflowStateType): Promise<RunResult> => {
    const snap = await graph.getState(cfg);
    const pending = snap.tasks.flatMap((t) => t.interrupts);
    if (pending.length) {
      waiting = pending[0].value as AskRequest;
      ports.emit('CUSTOM', {
        name: 'interrupt',
        ...(opts.app ? { app: opts.app } : {}),
        value:
          waiting.reason === 'question' ? { reason: 'question', text: waiting.text } : { reason: 'approval', station: waiting.station },
      });
      return summary(snap.values, 'waiting', undefined, waiting);
    }
    const v = snap.values ?? output;
    if (v.status === 'failed') return finish('failed', v.reason);
    if (v.status === 'stopped') return finish('stopped', v.reason);
    return finish('ok');
  };

  const guard = async (fn: () => Promise<WorkflowStateType>): Promise<RunResult> => {
    try {
      return await settle(await fn());
    } catch (e) {
      const aborted =
        e instanceof StoppedError || (e instanceof Error && (e.name === 'AbortError' || e.name === 'StoppedError')) || stopRequested;
      if (aborted) return finish('stopped', 'Stopped.');
      return finish('failed', e instanceof Error ? e.message : String(e));
    }
  };

  return {
    graph,
    get waiting() {
      return waiting;
    },
    start() {
      if (started) throw new Error('This run has already started.');
      started = true;
      ports.emit('RUN_STARTED', { ...extra, threadId: opts.app ?? opts.threadId });
      return guard(() => graph.invoke({}, cfg));
    },
    async resume(answer) {
      if (!waiting || finished) throw new Error('This run is not waiting for an answer.');
      const was = waiting;
      waiting = null;
      ports.emit('CUSTOM', {
        name: 'resume',
        ...(opts.app ? { app: opts.app } : {}),
        value: was.reason === 'question' ? { answer: was.options[Number(answer)] ?? answer } : { approved: !!answer, station: was.station },
      });
      return guard(() => graph.invoke(new Command({ resume: answer }), cfg));
    },
    stop() {
      stopRequested = true;
      if (waiting && !finished) {
        // Nothing is running while the run waits, so end it here.
        void finish('stopped', 'Stopped.');
      } else ctl.abort();
    },
  };
}
