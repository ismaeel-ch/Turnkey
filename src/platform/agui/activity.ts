/**
 * Agent activity: what each agent is doing, read from AG-UI events.
 *
 * Two kinds of event reach it. The workspace's own log (core.ts `EV`) holds AG-UI-shaped events from runs in the
 * browser, with extra fields such as `agent` and `app`. Runs of server agents through `runAgent` publish their real
 * AG-UI events on the bus below, with the agent and app they belong to. Both go through `toActivity` and
 * `deriveActivity`, which turn a list of events into a feed and the state of each agent.
 *
 * Pure and browser-safe: no React, nothing from src/server.
 */
import { addUsage, emptyUsage, readCallUsage, type CallUsage, type UsageSum } from './usage';

/** One AG-UI event as the workspace logs it: the AG-UI fields plus who it belongs to. */
export interface RawAgentEvent {
  type: string;
  seq?: number;
  t?: number;
  agent?: string | null;
  app?: string | null;
  runId?: string | null;
  server?: boolean;
  [field: string]: unknown;
}

export type ActivityKind =
  | 'run_started'
  | 'run_finished'
  | 'run_failed'
  | 'step_started'
  | 'step_finished'
  | 'message'
  | 'tool_call'
  | 'checks'
  | 'sent_back'
  | 'issues'
  | 'waiting'
  | 'resumed'
  | 'state'
  | 'handoff'
  | 'usage';

export interface ActivityItem {
  seq: number;
  t: number;
  kind: ActivityKind;
  /** The agent this happened to, once known. */
  agent: string | null;
  app: string | null;
  runId: string | null;
  /** Station or step name (STEP_STARTED's stepName). */
  step: string | null;
  /** True when the event came from an agent on the server. */
  server: boolean;
  /** Short text: a message, a tool's name, what changed. */
  text: string;
  /** For tool calls: input and result, already shortened. */
  args?: string;
  result?: string;
  toolCallId?: string;
  messageId?: string;
  /** For checks: how many passed and failed. For sent_back and issues: how many problems. */
  passed?: number;
  failed?: number;
  attempt?: number;
  /** For waiting: why the run stopped for a person (question, approval, jump_in). */
  reason?: string;
  /** For handoff: the agent that handed over. */
  from?: string;
  /** For run_finished: the status the run ended with. */
  status?: string;
  /** For usage: what one model call cost. */
  usage?: CallUsage;
}

export type AgentState = 'working' | 'waiting' | 'done' | 'failed' | 'idle';

export interface AgentStatus {
  id: string;
  state: AgentState;
  /** The step it is on, or finished last. */
  step: string | null;
  steps: number;
  tools: number;
  sentBack: number;
  last: number;
  /** Model calls this agent made on the server: tokens, cache hits and cost. Absent until it makes one. */
  usage?: UsageSum;
}

export interface ActivityModel {
  /** Oldest first. */
  items: ActivityItem[];
  agents: Record<string, AgentStatus>;
  /** True while some run in the events has started and not ended. */
  running: boolean;
  /** Every model call in the events, added up. */
  usage: UsageSum;
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const short = (v: unknown, n = 240): string => {
  const s = str(v).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Maps one event to an activity item, or null for events the feed does not show (deltas of tool arguments,
 * message starts). `agentOf` names the agent when the event does not, for example from a station id.
 */
export function toActivity(e: RawAgentEvent, agentOf?: (e: RawAgentEvent) => string | null): ActivityItem | null {
  if (!e || typeof e.type !== 'string') return null;
  const base = {
    seq: num(e.seq) ?? 0,
    t: num(e.t) ?? 0,
    agent: (typeof e.agent === 'string' && e.agent) || (agentOf ? agentOf(e) : null) || null,
    app: typeof e.app === 'string' ? e.app : null,
    runId: typeof e.runId === 'string' ? e.runId : null,
    step: typeof e.stepName === 'string' ? e.stepName : null,
    server: e.server === true,
    text: '',
  };
  switch (e.type) {
    case 'RUN_STARTED':
      return { ...base, kind: 'run_started' };
    case 'RUN_FINISHED':
      return { ...base, kind: 'run_finished', status: typeof e.status === 'string' ? e.status : 'done' };
    case 'RUN_ERROR':
      return { ...base, kind: 'run_failed', text: short(e.message) };
    case 'STEP_STARTED':
      return { ...base, kind: 'step_started' };
    case 'STEP_FINISHED':
      return { ...base, kind: 'step_finished' };
    case 'TEXT_MESSAGE_CONTENT':
      return { ...base, kind: 'message', text: str(e.delta), messageId: str(e.messageId) };
    case 'TOOL_CALL_START':
      return { ...base, kind: 'tool_call', text: str(e.toolCallName), toolCallId: str(e.toolCallId) };
    case 'TOOL_CALL_ARGS':
      return { ...base, kind: 'tool_call', text: '', args: str(e.delta), toolCallId: str(e.toolCallId) };
    case 'TOOL_CALL_RESULT':
      return { ...base, kind: 'tool_call', text: '', result: str(e.content), toolCallId: str(e.toolCallId) };
    case 'STATE_DELTA': {
      const paths = (Array.isArray(e.delta) ? e.delta : []).map((op) => str(rec(op).path).replace(/^\//, '')).filter(Boolean);
      return paths.length ? { ...base, kind: 'state', text: [...new Set(paths)].join(', ') } : null;
    }
    case 'CUSTOM': {
      const v = rec(e.value);
      const name = str(e.name);
      const station = typeof v.station === 'string' ? v.station : null;
      const agent = base.agent ?? (station && agentOf ? agentOf({ ...e, stepName: station }) : null);
      const withStep = { ...base, step: base.step ?? station, agent };
      if (name === 'checks')
        return { ...withStep, kind: 'checks', passed: num(v.passed) ?? 0, failed: num(v.failed) ?? 0, attempt: num(v.attempt) };
      if (name === 'sent_back') return { ...withStep, kind: 'sent_back', failed: num(v.issues) ?? 0, attempt: num(v.attempt) };
      if (name === 'issues') {
        const list = Array.isArray(v.issues) ? v.issues.map(str) : [];
        return { ...withStep, kind: 'issues', failed: list.length, attempt: num(v.attempt), text: short(list.join('; ')) };
      }
      if (name === 'interrupt') return { ...withStep, kind: 'waiting', reason: str(v.reason), text: short(v.text) };
      if (name === 'resume') return { ...withStep, kind: 'resumed' };
      if (name === 'usage') {
        const usage = readCallUsage(e.value);
        return usage ? { ...withStep, kind: 'usage', text: usage.model, usage } : null;
      }
      return null;
    }
    default:
      return null;
  }
}

const MAX_TEXT = 280;

/**
 * Turns events (oldest first) into the feed and each agent's state. Streamed message pieces become one message,
 * a tool call's start, arguments and result become one item, and a change of agent inside a run becomes a hand-off.
 */
export function deriveActivity(
  events: readonly RawAgentEvent[],
  options: { agentOf?: (e: RawAgentEvent) => string | null; app?: string | null; limit?: number } = {},
): ActivityModel {
  const items: ActivityItem[] = [];
  const agents: Record<string, AgentStatus> = {};
  const messages = new Map<string, ActivityItem>();
  const tools = new Map<string, ActivityItem>();
  const current = new Map<string, string>(); // run (or app) -> agent on the current step
  const open = new Set<string>(); // runs started and not ended
  const inRun = new Map<string, Set<string>>(); // run -> agents that worked in it
  const status = (id: string, t: number): AgentStatus => {
    const a = (agents[id] ??= { id, state: 'idle', step: null, steps: 0, tools: 0, sentBack: 0, last: 0 });
    a.last = Math.max(a.last, t);
    return a;
  };
  const runKey = (it: ActivityItem) => it.runId ?? it.app ?? '';
  const usage = emptyUsage();

  for (const e of events) {
    const it = toActivity(e, options.agentOf);
    if (!it) continue;
    if (options.app && it.app !== options.app) continue;
    const key = runKey(it);
    // the agent on the current step owns what does not name one: checks, a question, a hand-back
    if (!it.agent && it.kind !== 'run_started' && it.kind !== 'run_finished' && it.kind !== 'run_failed')
      it.agent = current.get(key) ?? current.get('app:' + it.app) ?? null;

    if (it.kind === 'message') {
      const mk = it.messageId || `${key}:${it.agent}`;
      const m = messages.get(mk);
      if (m) {
        m.text = (m.text + it.text).slice(0, MAX_TEXT);
        m.t = it.t;
        continue;
      }
      it.text = it.text.slice(0, MAX_TEXT);
      messages.set(mk, it);
    }
    if (it.kind === 'tool_call' && it.toolCallId) {
      const c = tools.get(it.toolCallId);
      if (c) {
        if (it.args) c.args = short(it.args, 400);
        if (it.result) c.result = short(it.result, 400);
        continue;
      }
      if (!it.text) continue; // arguments or a result for a call we never saw start
      tools.set(it.toolCallId, it);
      if (it.agent) status(it.agent, it.t).tools++;
    }

    switch (it.kind) {
      case 'run_started':
        open.add(key);
        break;
      case 'run_finished':
      case 'run_failed':
        open.delete(key);
        for (const id of inRun.get(key) ?? []) {
          const a = agents[id];
          if (a && (a.state === 'working' || a.state === 'waiting')) a.state = it.kind === 'run_failed' ? 'failed' : 'done';
        }
        inRun.delete(key);
        current.delete(key);
        if (it.app) current.delete('app:' + it.app);
        break;
      case 'step_started': {
        if (!it.agent) break;
        const before = current.get(key);
        if (!it.server && before && before !== it.agent && before !== 'orchestrator' && it.agent !== 'orchestrator')
          items.push({ ...it, kind: 'handoff', from: before, seq: it.seq - 0.5 });
        // a step on the server is a part of one agent's turn, not a new agent
        if (before && before !== it.agent && agents[before]?.state === 'working' && !it.server) agents[before].state = 'done';
        current.set(key, it.agent);
        if (it.app) current.set('app:' + it.app, it.agent);
        if (!inRun.has(key)) inRun.set(key, new Set());
        inRun.get(key)!.add(it.agent);
        const a = status(it.agent, it.t);
        a.state = 'working';
        a.step = it.step;
        a.steps++;
        break;
      }
      case 'step_finished':
        if (it.agent && !it.server) status(it.agent, it.t).state = 'done';
        break;
      case 'sent_back':
        if (it.agent) {
          const a = status(it.agent, it.t);
          a.sentBack++;
          a.state = 'working';
        }
        break;
      case 'waiting':
        if (it.agent) status(it.agent, it.t).state = 'waiting';
        break;
      case 'resumed':
        if (it.agent && agents[it.agent]?.state === 'waiting') agents[it.agent].state = 'working';
        break;
      case 'usage':
        if (it.usage) {
          addUsage(usage, it.usage);
          if (it.agent) {
            const a = status(it.agent, it.t);
            addUsage((a.usage ??= emptyUsage()), it.usage);
          }
        }
        break;
    }
    items.push(it);
  }
  const limit = options.limit ?? 300;
  return { items: items.length > limit ? items.slice(-limit) : items, agents, running: open.size > 0, usage };
}

/* ---------- the bus: server agent runs publish here, the workspace listens ---------- */

export interface AgentEventContext {
  /** Which Turnkey agent ran: a builder role such as "database", or an app team agent's id. */
  agent: string;
  /** The app the run belongs to, when there is one. */
  app?: string | null;
}

type Listener = (event: RawAgentEvent) => void;
const listeners = new Set<Listener>();

/** Called by `runAgent` for every AG-UI event of a server run. */
export function publishAgentEvent(event: { type: string; [field: string]: unknown }, context: AgentEventContext): void {
  if (!listeners.size) return;
  const out: RawAgentEvent = { ...event, type: String(event.type), agent: context.agent, app: context.app ?? null, server: true };
  for (const fn of listeners) {
    try {
      fn(out);
    } catch {
      // a broken listener must not stop the run
    }
  }
}

/** Listen to every server agent event. Returns the function that stops listening. */
export function subscribeAgentEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
