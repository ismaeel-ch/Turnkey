import { Annotation, END, interrupt, MemorySaver, START, StateGraph } from '@langchain/langgraph/web';
import { installBrowserContext } from './browser-context';
import { StoppedError } from './types';
import type {
  AskRequest,
  GateResult,
  Ports,
  Question,
  RunOptions,
  RunStatus,
  StationDef,
  StepDef,
  TestRound,
  WorkflowDefinition,
} from './types';

installBrowserContext();

const concat = <T>(a: T[], b: T[]) => a.concat(b);
const sum = (a: number, b: number) => a + b;

/** The state the graph passes between nodes. Keep keys short and different from node names. */
export const WorkflowState = Annotation.Root({
  status: Annotation<RunStatus>({ reducer: (_a, b) => b, default: () => 'running' }),
  reason: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  station: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  attempt: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  feedback: Annotation<string[] | null>({ reducer: (_a, b) => b, default: () => null }),
  gate: Annotation<{ ok: boolean; issues: string[] } | null>({ reducer: (_a, b) => b, default: () => null }),
  ask: Annotation<Question | null>({ reducer: (_a, b) => b, default: () => null }),
  retries: Annotation<number>({ reducer: sum, default: () => 0 }),
  round: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  failed: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  progress: Annotation<boolean>({ reducer: (_a, b) => b, default: () => true }),
  rounds: Annotation<TestRound[]>({ reducer: concat, default: () => [] }),
  qa: Annotation<'ok' | 'failed' | ''>({ reducer: (_a, b) => b, default: () => '' }),
  trail: Annotation<string[]>({ reducer: concat, default: () => [] }),
});
export type WorkflowStateType = typeof WorkflowState.State;
type Update = Partial<WorkflowStateType>;
type NodeFn = (s: WorkflowStateType) => Promise<Update> | Update;

/**
 * LangGraph types node names as a union that grows with each `addNode`. Names here come from data, so the builder
 * is used through this narrow view instead of its generated generics.
 */
interface LooseBuilder {
  addNode(name: string, fn: NodeFn): LooseBuilder;
  addEdge(from: string, to: string): LooseBuilder;
  addConditionalEdges(from: string, route: (s: WorkflowStateType) => string, targets: string[]): LooseBuilder;
  compile(o: { checkpointer: MemorySaver }): CompiledWorkflow;
}

export interface CompiledWorkflow {
  invoke(input: unknown, config: Record<string, unknown>): Promise<WorkflowStateType>;
  getState(
    config: Record<string, unknown>,
  ): Promise<{ next: string[]; values: WorkflowStateType; tasks: { interrupts: { value: unknown }[] }[] }>;
  getGraph(): { drawMermaid(): string };
}

export const nodeName = {
  station: (id: string) => `st_${id}`,
  gate: (id: string) => `st_${id}_gate`,
  sendback: (id: string) => `st_${id}_sendback`,
  fallback: (id: string) => `st_${id}_fallback`,
  fail: (id: string) => `st_${id}_fail`,
  done: (id: string) => `st_${id}_done`,
  ask: (id: string) => `st_${id}_ask`,
  answer: (id: string) => `st_${id}_answer`,
  step: (after: string, id: string) => `st_${after}_step_${id}`,
  approve: (id: string) => `st_${id}_approve`,
  handoff: (id: string) => `st_${id}_handoff`,
};

const clampAttempts = (n: number) => (n >= 1 && n <= 3 ? Math.round(n) : 3);
const triesWord = (n: number) => (n === 1 ? 'one attempt' : n === 2 ? 'two attempts' : 'three attempts');

/**
 * Compile a workflow definition into a LangGraph graph. Stations are nodes. A gate is a conditional edge that sends
 * the work back with the failures until the attempts run out. Approvals and the Researcher's question are interrupts.
 * Added steps and the owner's own agents are nodes at their positions. The Tester and its repair loop close the graph.
 * The graph holds an in-memory checkpointer, which interrupts need.
 */
export function compileWorkflow(def: WorkflowDefinition, ports: Ports, opts: RunOptions = {}): CompiledWorkflow {
  if (!def.stations.length) throw new Error('A workflow needs at least one station.');
  const max = clampAttempts(def.attempts);
  const testerMax = Math.max(1, Math.min(3, Math.round(def.testerRounds ?? 3)));
  const emit = (type: string, extra: Record<string, unknown>) =>
    ports.emit(type, { ...extra, ...(opts.runId ? { runId: opts.runId } : {}), ...(opts.app ? { app: opts.app } : {}) });
  const custom = (name: string, value: Record<string, unknown>) => emit('CUSTOM', { name, value });
  const alive = () => {
    if (ports.stopped?.()) throw new StoppedError();
  };
  /** Wrap a node: check for a stop first, and record that it ran. */
  const node =
    (name: string, fn: NodeFn): NodeFn =>
    async (s) => {
      alive();
      const out = await fn(s);
      return { ...out, trail: [name] };
    };

  const g = new StateGraph(WorkflowState) as unknown as LooseBuilder;
  const ids = def.stations.map((s) => s.id);
  const startIdx = def.from ? Math.max(0, ids.indexOf(def.from)) : 0;
  const stationsRun = def.stations.slice(startIdx);
  const stepsAfter = (id: string): StepDef[] => def.steps.filter((x) => x.after === id);
  for (const x of def.steps) if (!ids.includes(x.after)) throw new Error(`Step ${x.id} sits after ${x.after}, which is not a station.`);

  // Each station is a chain of nodes. `head`/`tail` are the first and last node of that chain.
  const heads: string[] = [];
  const tails: string[] = [];
  const approveNodes: Record<string, string> = {};

  for (const st of stationsRun) {
    const byRules = !!st.byRules;
    const mx = byRules ? 1 : max;
    const nStation = nodeName.station(st.id);
    const nGate = nodeName.gate(st.id);
    const nSend = nodeName.sendback(st.id);
    const nFall = nodeName.fallback(st.id);
    const nFail = nodeName.fail(st.id);
    const nDone = nodeName.done(st.id);
    const hasFallback = !!st.fallback && !byRules && !!ports.fallback;

    g.addNode(
      nStation,
      node(nStation, async (s) => {
        const first = s.station !== st.id;
        const attempt = first ? 1 : s.attempt + 1;
        if (first) emit('STEP_STARTED', { stepName: st.id });
        const res = await ports.runStation({ station: st, attempt, max: mx, feedback: first ? null : s.feedback, byRules });
        const unusable = res && res.issues && res.issues.length ? res.issues : null;
        return { station: st.id, attempt, gate: unusable ? { ok: false, issues: unusable } : null, status: 'running' };
      }),
    );

    g.addNode(
      nGate,
      node(nGate, async (s) => {
        let issues: string[];
        let passed = 0;
        let total = 0;
        if (s.gate && !s.gate.ok) {
          issues = s.gate.issues;
          total = issues.length;
        } else {
          const r: GateResult = await ports.runGate({ station: st, attempt: s.attempt, max: mx, last: s.attempt >= mx });
          issues = r.issues;
          passed = r.passed;
          total = r.total;
        }
        custom('checks', { station: st.id, attempt: s.attempt, passed: passed || total - issues.length, failed: issues.length });
        return { gate: { ok: issues.length === 0, issues } };
      }),
    );

    g.addNode(
      nSend,
      node(nSend, async (s) => {
        const issues = s.gate?.issues ?? [];
        await ports.sentBack({ station: st, attempt: s.attempt, issues });
        custom('sent_back', { station: st.id, attempt: s.attempt, issues: issues.length });
        return { retries: 1, feedback: issues };
      }),
    );

    if (hasFallback) {
      g.addNode(
        nFall,
        node(nFall, async () => {
          const r = await ports.fallback!({ station: st });
          return { gate: { ok: r.ok, issues: r.issues } };
        }),
      );
    }

    g.addNode(
      nFail,
      node(nFail, async (s) => {
        const first = s.gate?.issues[0] ?? 'A check failed.';
        const reason = byRules
          ? `${st.name} could not be built by the rules. ${first}`
          : `${st.name} did not pass its checks after ${triesWord(mx)}. ${first}`;
        return { status: 'failed', reason };
      }),
    );

    g.addNode(
      nDone,
      node(nDone, async () => {
        await ports.stationDone({ station: st });
        emit('STEP_FINISHED', { stepName: st.id });
        return { gate: null, feedback: null };
      }),
    );

    g.addEdge(nStation, nGate);
    // The gate: pass, send back, safe default, or fail.
    const exhausted = hasFallback ? nFall : nFail;
    const gateTargets = [nDone, nSend, exhausted];
    g.addConditionalEdges(nGate, (s) => (s.gate?.ok ? nDone : s.attempt < mx ? nSend : exhausted), gateTargets);
    g.addEdge(nSend, nStation);
    if (hasFallback) g.addConditionalEdges(nFall, (s) => (s.gate?.ok ? nDone : nFail), [nDone, nFail]);
    g.addEdge(nFail, END);

    // After the station: the question, added steps, the approval, the hand-off.
    const chain: string[] = [nDone];
    if (st.asks) {
      const nAsk = nodeName.ask(st.id);
      const nAns = nodeName.answer(st.id);
      g.addNode(
        nAsk,
        node(nAsk, async () => ({ ask: await ports.owner.question(st) })),
      );
      g.addNode(nAns, async (s) => {
        // Interrupts run this node again from the top when resumed, so the interrupt comes before the first await.
        alive();
        const q = s.ask;
        if (!q) return { trail: [nAns] };
        const request: AskRequest = { reason: 'question', station: st.id, text: q.text, options: q.options, recommended: q.recommended };
        const index = interrupt(request) as number;
        await ports.owner.answered({ station: st, question: q, index });
        return { ask: null, trail: [nAns] };
      });
      chain.push(nAsk, nAns);
    }
    for (const stp of stepsAfter(st.id)) {
      const nStep = nodeName.step(st.id, stp.id);
      g.addNode(
        nStep,
        node(nStep, async () => {
          emit('STEP_STARTED', { stepName: `review_${stp.id}` });
          await ports.runStep({ step: stp, station: st.id });
          emit('STEP_FINISHED', { stepName: `review_${stp.id}` });
          return {};
        }),
      );
      chain.push(nStep);
    }
    if (def.approvals.includes(st.id)) {
      const nApp = nodeName.approve(st.id);
      g.addNode(nApp, async () => {
        alive();
        const request: AskRequest = { reason: 'approval', station: st.id };
        const approved = interrupt(request) as boolean;
        await ports.owner.decided({ station: st, approved: !!approved });
        return approved
          ? { trail: [nApp] }
          : { status: 'stopped' as RunStatus, reason: `You stopped the build after ${st.name}.`, trail: [nApp] };
      });
      chain.push(nApp);
      approveNodes[st.id] = nApp;
    }
    const last = st.id === def.stations[def.stations.length - 1].id;
    if (!last && ports.handoff) {
      const nHand = nodeName.handoff(st.id);
      g.addNode(
        nHand,
        node(nHand, async () => {
          await ports.handoff!({ station: st });
          return {};
        }),
      );
      chain.push(nHand);
    }
    heads.push(nStation);
    tails.push(chain[chain.length - 1]);
    // Edges inside the chain. An approval that is refused leaves through the conditional edge added below.
    for (let i = 0; i < chain.length - 1; i++) {
      if (chain[i] === approveNodes[st.id]) continue;
      g.addEdge(chain[i], chain[i + 1]);
    }
    if (approveNodes[st.id]) {
      const idx = chain.indexOf(approveNodes[st.id]);
      const after = chain[idx + 1];
      // Only when the hand-off follows. When the approval is the station's last node, the join below handles it.
      if (after) g.addConditionalEdges(approveNodes[st.id], (s) => (s.status === 'stopped' ? END : after), [END, after]);
    }
  }

  // Join the stations in order, then the end of the line.
  const nLate = 'late_steps';
  const nReady = 'ready';
  const nWrite = 'tests_write';
  const nRun = 'tests_run';
  const nRepair = 'tests_repair';
  const nTestsDone = 'tests_done';
  const nWrap = 'wrapup';

  g.addNode(
    nLate,
    node(nLate, async () => {
      const late = (await ports.lateSteps?.()) ?? [];
      for (const stp of late) {
        alive();
        emit('STEP_STARTED', { stepName: `review_${stp.id}` });
        await ports.runStep({ step: stp, station: stp.after });
        emit('STEP_FINISHED', { stepName: `review_${stp.id}` });
      }
      return {};
    }),
  );
  g.addNode(
    nReady,
    node(nReady, async () => {
      await ports.ready();
      return {};
    }),
  );
  g.addNode(
    nWrite,
    node(nWrite, async () => {
      emit('STEP_STARTED', { stepName: 'tests' });
      await ports.tester.write();
      return { round: 0, rounds: [] };
    }),
  );
  g.addNode(
    nRun,
    node(nRun, async (s) => {
      const round = s.round + 1;
      const r = await ports.tester.run({ round, max: testerMax });
      return { round, failed: r.failed, rounds: [r] };
    }),
  );
  g.addNode(
    nRepair,
    node(nRepair, async (s) => {
      const r = await ports.tester.repair({ round: s.round, failed: s.failed });
      return { retries: 1, progress: r.progress };
    }),
  );
  g.addNode(
    nTestsDone,
    node(nTestsDone, async (s) => {
      const qa = s.failed ? 'failed' : 'ok';
      await ports.tester.done({ status: qa, rounds: s.rounds });
      emit('STEP_FINISHED', { stepName: 'tests' });
      return { qa };
    }),
  );
  g.addNode(
    nWrap,
    node(nWrap, async (s) => {
      await ports.wrapUp({ qa: s.failed ? 'failed' : 'ok', retries: s.retries });
      return { status: 'ok' };
    }),
  );

  g.addEdge(nLate, nReady);
  g.addEdge(nReady, nWrite);
  g.addEdge(nWrite, nRun);
  g.addConditionalEdges(nRun, (s) => (s.failed === 0 || s.round >= testerMax ? nTestsDone : nRepair), [nTestsDone, nRepair]);
  g.addConditionalEdges(nRepair, (s) => (s.progress ? nRun : nTestsDone), [nRun, nTestsDone]);
  g.addEdge(nTestsDone, nWrap);
  g.addEdge(nWrap, END);

  g.addEdge(START, heads[0]);
  for (let i = 0; i < stationsRun.length; i++) {
    const target = i + 1 < stationsRun.length ? heads[i + 1] : nLate;
    const st = stationsRun[i];
    if (tails[i] === approveNodes[st.id]) {
      const t = target;
      g.addConditionalEdges(tails[i], (s) => (s.status === 'stopped' ? END : t), [END, t]);
    } else {
      g.addEdge(tails[i], target);
    }
  }

  return g.compile({ checkpointer: new MemorySaver() });
}
