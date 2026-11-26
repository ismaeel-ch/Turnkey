/**
 * Compiles a team definition into a LangGraph graph. Server only.
 *
 * For each agent, in the order of the definition:
 *
 *   [pause_<id>]  only where the definition says a person may add a point before this agent
 *   agent_<id>    one model call: it either asks for a lookup or gives its answer
 *   tools_<id>    only if the agent has tools: runs the lookup and hands the result back to the agent
 *   check_<id>    rules, then a reviewer model; can send the work back to the agent once, with the reason
 *
 * and one `finish` node that every run passes through, whether it completed or hit a cap.
 */
import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from '@langchain/langgraph';
import { agentPrompt, reviewPrompt, SYSTEM, type Lookup } from './prompts';
import { extractJson, normalizeOutput, parseTurn, ruleCheck } from './protocol';
import type { AgentOutput, AgentSpec, EventSink, Note, TeamLimits, TeamRequest } from './types';
import { TeamLimitsSchema } from './types';
import type { ToolBox, ToolInfo } from './tools';
import type { Provider } from '../../llm';

export const ATTEMPTS_PER_STEP = 3;
export const SENDBACKS_PER_AGENT = 1;

export type TeamContext = {
  provider: Provider;
  tools: ToolBox;
  sink: EventSink;
  signal?: AbortSignal;
  /** called before every model call. It may throw, for example when the spend limit is reached. */
  beforeModelCall?: () => void;
  now?: () => number;
};

/** What a run has used so far. Lives for one request; a resumed run starts from what the earlier request used. */
export class Budget {
  steps = 0;
  calls = 0;
  readonly limits: TeamLimits;
  private readonly t0: number;
  constructor(
    limits: Partial<TeamLimits> = {},
    private readonly now: () => number = Date.now,
    used?: { steps: number; calls: number },
  ) {
    this.limits = TeamLimitsSchema.parse(limits);
    this.t0 = now();
    if (used) {
      this.steps = used.steps;
      this.calls = used.calls;
    }
  }
  /** Why the run must stop now, or null. */
  get over(): string | null {
    if (this.steps >= this.limits.maxSteps) return `The run reached its limit of ${this.limits.maxSteps} steps.`;
    if (this.calls >= this.limits.maxModelCalls) return `The run reached its limit of ${this.limits.maxModelCalls} model calls.`;
    if (this.now() - this.t0 >= this.limits.maxMillis) return 'The run reached its time limit.';
    return null;
  }
}

type Rows = Record<string, Record<string, unknown>[]>;
type Pending = { connector: string; tool: string; args: Record<string, string> };
export type Turn = {
  agent: string;
  lookups: Lookup[];
  toolCalls: number;
  sendbacks: number;
  feedback: string;
  pending: Pending | null;
  draft: AgentOutput | null;
  problems: string[];
};
const emptyTurn = (agent = ''): Turn => ({
  agent,
  lookups: [],
  toolCalls: 0,
  sendbacks: 0,
  feedback: '',
  pending: null,
  draft: null,
  problems: [],
});

const State = Annotation.Root({
  work: Annotation<Rows>({
    reducer: (a, b) => {
      const o: Rows = { ...a };
      for (const [k, v] of Object.entries(b)) o[k] = (o[k] ?? []).concat(v);
      return o;
    },
    default: () => ({}),
  }),
  outputs: Annotation<Record<string, AgentOutput>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  notes: Annotation<Note[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  turn: Annotation<Turn>({ reducer: (_a, b) => b, default: () => emptyTurn() }),
  stopped: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
});
export type TeamState = typeof State.State;

export class RunFailure extends Error {
  constructor(
    message: string,
    readonly code = 'failed',
  ) {
    super(message);
  }
}

let counter = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function nodeNames(id: string) {
  return { agent: `agent_${id}`, tools: `tools_${id}`, check: `check_${id}`, pause: `pause_${id}` };
}

export function buildTeamGraph(req: TeamRequest, ctx: TeamContext, budget: Budget) {
  const { team } = req;
  const agents = team.agents;
  const sink = ctx.sink;

  async function ask(system: string, user: string, tier: 'default' | 'quick'): Promise<string> {
    if (ctx.signal?.aborted) throw new RunFailure('The run was stopped.', 'aborted');
    ctx.beforeModelCall?.();
    budget.calls++;
    let text = '';
    for await (const chunk of ctx.provider.stream({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      tier,
      maxTokens: 3000,
      signal: ctx.signal,
    })) {
      if (chunk.type === 'delta') text += chunk.text;
    }
    return text;
  }

  const toolsOf = (a: AgentSpec): ToolInfo[] => a.tools.map((t) => ctx.tools.info(t.connector, t.tool)).filter((x): x is ToolInfo => !!x);

  const agentNode = (a: AgentSpec) => async (s: TeamState) => {
    const turn = s.turn.agent === a.id ? s.turn : emptyTurn(a.id);
    if (s.turn.agent !== a.id) sink.emit({ type: 'STEP_STARTED', stepName: a.id });
    budget.steps++;
    const tools = toolsOf(a);
    const left = Math.max(0, budget.limits.toolCallsPerAgent - turn.toolCalls);
    let extra = '';
    for (let attempt = 1; attempt <= ATTEMPTS_PER_STEP; attempt++) {
      if (budget.over) return { turn };
      const canLookup = tools.length > 0 && left > 0;
      const prompt =
        agentPrompt({
          req,
          agent: a,
          work: s.work,
          notes: [...req.notes, ...s.notes],
          tools: canLookup ? tools : [],
          lookups: turn.lookups,
          lookupsLeft: left,
          feedback: turn.feedback,
        }) + extra;
      const raw = await ask(SYSTEM, prompt, 'default');
      try {
        const t = parseTurn(raw);
        if (t.kind === 'tool') {
          const known = a.tools.some((x) => x.connector === t.connector && x.tool === t.tool);
          if (!canLookup || !known)
            throw new Error(
              canLookup
                ? `You may only use: ${a.tools.map((x) => x.connector + '.' + x.tool).join(', ')}.`
                : 'You cannot look anything up now. Give your final answer.',
            );
          return { turn: { ...turn, pending: { connector: t.connector, tool: t.tool, args: t.args }, draft: null } };
        }
        const { output, problems } = normalizeOutput(t.raw, a, req.tables, req.input.table);
        return { turn: { ...turn, pending: null, draft: output, problems } };
      } catch (e) {
        extra = `\n\nYour last reply was not usable: ${(e as Error).message} Reply with the JSON object only.`;
        if (attempt === ATTEMPTS_PER_STEP)
          throw new RunFailure(`${a.name} did not give a usable answer after ${ATTEMPTS_PER_STEP} tries.`, 'bad_output');
      }
    }
    return { turn };
  };

  const toolsNode = (a: AgentSpec) => async (s: TeamState) => {
    const turn = s.turn;
    const p = turn.pending;
    budget.steps++;
    if (!p) return { turn };
    const id = uid('tool');
    const name = `${p.connector}.${p.tool}`;
    sink.emit({ type: 'TOOL_CALL_START', toolCallId: id, toolCallName: name });
    sink.emit({ type: 'TOOL_CALL_ARGS', toolCallId: id, delta: JSON.stringify(p.args) });
    sink.emit({ type: 'TOOL_CALL_END', toolCallId: id });
    let result: { ok: boolean; text: string };
    try {
      result = await ctx.tools.run(p.connector, p.tool, p.args, ctx.signal);
    } catch (e) {
      result = { ok: false, text: 'The lookup failed: ' + (e as Error).message };
    }
    const text = result.text.slice(0, 2000);
    sink.emit({
      type: 'TOOL_CALL_RESULT',
      messageId: uid('m'),
      toolCallId: id,
      content: JSON.stringify({ agent: a.id, ok: result.ok, text: text.slice(0, 600) }),
      role: 'tool',
    });
    const label = `${name} ${Object.values(p.args)[0] ?? ''}`.trim();
    return { turn: { ...turn, pending: null, toolCalls: turn.toolCalls + 1, lookups: [...turn.lookups, { label, ok: result.ok, text }] } };
  };

  const checkNode = (a: AgentSpec) => async (s: TeamState) => {
    budget.steps++;
    const turn = s.turn;
    const draft = turn.draft;
    if (!draft) return { turn }; // the agent ended without an answer because a cap was hit; the router sends the run to finish
    const hasRows = !!a.updates && (s.work[a.updates]?.length ?? 0) > 0;
    const bad = ruleCheck(a, draft, turn.problems, hasRows);
    let reason = bad.join(' ');
    let by = 'rules';
    if (!reason && req.review && !budget.over) {
      try {
        const raw = await ask(SYSTEM, reviewPrompt(req, a, draft), 'quick');
        const r = extractJson(raw) as { ok?: unknown; reason?: unknown };
        if (r && r.ok === false && typeof r.reason === 'string' && r.reason.trim()) {
          reason = r.reason.trim().slice(0, 300);
          by = 'reviewer';
        }
      } catch (e) {
        if (e instanceof RunFailure) throw e;
        // an unreadable review lets the work through: the rules above have already passed
      }
    }
    if (reason && turn.sendbacks < SENDBACKS_PER_AGENT && !budget.over) {
      sink.emit({ type: 'CUSTOM', name: 'check', value: { agent: a.id, ok: false, sentBack: true, by, reason } });
      return { turn: { ...turn, sendbacks: turn.sendbacks + 1, feedback: reason, draft: null, pending: null, problems: [] } };
    }
    sink.emit({
      type: 'CUSTOM',
      name: 'check',
      value: { agent: a.id, ok: !reason, sentBack: false, by, ...(reason ? { reason, accepted: 'second answer kept' } : {}) },
    });
    // the work is accepted: show it, then hand over
    const mid = uid('m');
    sink.emit({ type: 'TEXT_MESSAGE_START', messageId: mid, role: 'assistant' });
    sink.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: mid, delta: draft.say });
    sink.emit({ type: 'TEXT_MESSAGE_END', messageId: mid });
    const written: Rows = {};
    if (a.writes && draft.rows.length) {
      const fixed = a.fixed as Record<string, unknown>;
      written[a.writes] = draft.rows.map((r) => ({ ...r, ...fixed }));
      for (const r of written[a.writes]) sink.emit({ type: 'STATE_DELTA', delta: [{ op: 'add', path: `/work/${a.writes}/-`, value: r }] });
    }
    sink.emit({ type: 'STATE_DELTA', delta: [{ op: 'add', path: `/outputs/${a.id}`, value: draft }] });
    sink.emit({ type: 'STEP_FINISHED', stepName: a.id });
    return { work: written, outputs: { [a.id]: draft }, turn: emptyTurn() };
  };

  const finishNode = (s: TeamState) => {
    return { stopped: budget.over && Object.keys(s.outputs).length < agents.length ? budget.over : s.stopped };
  };

  const pauseNode = (a: AgentSpec) => () => {
    const note = interrupt({ before: a.id, text: team.pause?.text ?? '' }) as Note | null | undefined;
    return note && note.text ? { notes: [note] } : {};
  };

  const g = new StateGraph(State);
  const firstOf = (i: number) => (team.pause?.before === agents[i].id ? nodeNames(agents[i].id).pause : nodeNames(agents[i].id).agent);
  const nextOf = (i: number) => (i + 1 < agents.length ? firstOf(i + 1) : 'finish');

  agents.forEach((a, i) => {
    const n = nodeNames(a.id);
    const hasTools = a.tools.length > 0;
    if (team.pause?.before === a.id) {
      g.addNode(n.pause, pauseNode(a));
      g.addEdge(n.pause as never, n.agent as never);
    }
    g.addNode(n.agent, agentNode(a));
    g.addNode(n.check, checkNode(a));
    if (hasTools) {
      g.addNode(n.tools, toolsNode(a));
      g.addEdge(n.tools as never, n.agent as never);
    }
    const out: Record<string, string> = { finish: 'finish', check: n.check };
    if (hasTools) out.tools = n.tools;
    g.addConditionalEdges(
      n.agent as never,
      ((s: TeamState) => (budget.over ? 'finish' : s.turn.pending && hasTools ? 'tools' : 'check')) as never,
      out as never,
    );
    g.addConditionalEdges(
      n.check as never,
      ((s: TeamState) =>
        s.turn.agent === a.id && !s.turn.draft && !budget.over
          ? 'again'
          : budget.over && s.turn.agent === a.id
            ? 'finish'
            : 'next') as never,
      { again: n.agent, finish: 'finish', next: nextOf(i) } as never,
    );
  });
  g.addNode('finish', finishNode);
  g.addEdge('finish' as never, END);
  g.addEdge(START, firstOf(0) as never);
  return g.compile({ checkpointer: new MemorySaver() });
}

export { Command };

/** The compiled graph of a team as a Mermaid diagram, for documentation and the debug view. Calls no model. */
export async function teamGraphMermaid(req: TeamRequest): Promise<string> {
  const graph = buildTeamGraph(
    req,
    {
      provider: { id: 'none', model: () => '', stream: async function* () {} },
      tools: { info: () => null, run: async () => ({ ok: false, text: '' }) },
      sink: { emit: () => {} },
    },
    new Budget(req.limits),
  );
  return (await graph.getGraphAsync()).drawMermaid();
}
