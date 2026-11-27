/**
 * Browser client for Turnkey's agents. Runs an agent by id against /api/copilotkit, streams its AG-UI events to
 * callbacks, supports abort, and resolves with one final result. No CopilotKit UI components.
 * Safe for the browser: it imports nothing from src/server.
 */
import { HttpAgent, type AgentSubscriber } from '@ag-ui/client';
import type { BaseEvent, Message, State } from '@ag-ui/core';
import { publishAgentEvent, type AgentEventContext } from './activity';

export const AGENT_BASE_URL = '/api/copilotkit';

export interface AgentCallbacks {
  /** Every event, as it arrives. For the debug drawer. */
  onEvent?: (event: BaseEvent) => void;
  onStepStarted?: (name: string) => void;
  onStepFinished?: (name: string) => void;
  /** A piece of streamed text, plus all the text of that message so far. */
  onText?: (delta: string, messageId: string, soFar: string) => void;
  onTextEnd?: (messageId: string, text: string) => void;
  /** A finished tool call with its parsed arguments. */
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown> }) => void;
  onToolResult?: (result: { id: string; content: string }) => void;
  /** The shared state after a snapshot or delta. */
  onState?: (state: State) => void;
  /** A named event sent with CUSTOM. */
  onCustom?: (name: string, value: unknown) => void;
}

export interface RunAgentOptions extends AgentCallbacks {
  /** Chat messages to send. A plain string becomes one user message. */
  messages?: Message[] | string;
  /** Shared state sent with the run. */
  state?: State;
  /** Agent-specific input (the contract of the agent). */
  forwardedProps?: Record<string, unknown>;
  threadId?: string;
  /** Abort to stop the run. The promise then resolves with `aborted: true`. */
  signal?: AbortSignal;
  /** Defaults to /api/copilotkit. */
  baseUrl?: string;
  /** For tests. */
  fetch?: typeof fetch;
  /**
   * Who this run is, for the agent activity panel. Every event is published there with this agent and app.
   * Defaults to `forwardedProps.role` (a builder role), else the agent id. `false` keeps the run out of the panel.
   */
  activity?: Partial<AgentEventContext> | false;
}

export type AgentRunResult =
  | { ok: true; result: unknown; state: State; messages: Message[] }
  | { ok: false; aborted: boolean; error: { code: string; message: string }; state: State };

const abortedResult = (state: State): AgentRunResult => ({
  ok: false,
  aborted: true,
  error: { code: 'aborted', message: 'The run was stopped.' },
  state,
});

export async function runAgent(agentId: string, options: RunAgentOptions = {}): Promise<AgentRunResult> {
  const base = (options.baseUrl ?? AGENT_BASE_URL).replace(/\/$/, '');
  const agent = new HttpAgent({
    url: `${base}/agent/${encodeURIComponent(agentId)}/run`,
    agentId,
    threadId: options.threadId,
    initialState: options.state ?? {},
    initialMessages: typeof options.messages === 'string' ? [] : (options.messages ?? []),
    ...(options.fetch ? { fetch: (url: string, init: RequestInit) => options.fetch!(url, init) } : {}),
  });
  if (typeof options.messages === 'string') {
    agent.addMessage({ id: globalThis.crypto.randomUUID(), role: 'user', content: options.messages });
  }

  let failure: { code: string; message: string } | null = null;
  const texts = new Map<string, string>();
  const names = new Map<string, string>();
  const role = options.forwardedProps?.role;
  const who: AgentEventContext | null =
    options.activity === false
      ? null
      : { agent: options.activity?.agent || (typeof role === 'string' && role) || agentId, app: options.activity?.app ?? null };
  const subscriber: AgentSubscriber = {
    onEvent: ({ event }) => {
      if (who) publishAgentEvent(event, who);
      options.onEvent?.(event);
    },
    onStepStartedEvent: ({ event }) => options.onStepStarted?.(event.stepName),
    onStepFinishedEvent: ({ event }) => options.onStepFinished?.(event.stepName),
    onTextMessageContentEvent: ({ event }) => {
      const soFar = (texts.get(event.messageId) ?? '') + event.delta;
      texts.set(event.messageId, soFar);
      options.onText?.(event.delta, event.messageId, soFar);
    },
    onTextMessageEndEvent: ({ event }) => options.onTextEnd?.(event.messageId, texts.get(event.messageId) ?? ''),
    onToolCallStartEvent: ({ event }) => void names.set(event.toolCallId, event.toolCallName),
    onToolCallEndEvent: ({ event, toolCallName, toolCallArgs }) =>
      options.onToolCall?.({ id: event.toolCallId, name: toolCallName, args: toolCallArgs }),
    onToolCallResultEvent: ({ event }) =>
      options.onToolResult?.({
        id: event.toolCallId,
        content: typeof event.content === 'string' ? event.content : JSON.stringify(event.content),
      }),
    onStateChanged: ({ state }) => options.onState?.(state as State),
    onCustomEvent: ({ event }) => options.onCustom?.(event.name, event.value),
    onRunErrorEvent: ({ event }) => {
      failure = { code: event.code ?? 'agent_error', message: event.message };
    },
  };

  // Aborting cancels the request (abortRun) and settles this promise at once, even if the transport is slow to react.
  let onAbort = () => {};
  const aborted = new Promise<'aborted'>((resolve) => {
    onAbort = () => {
      agent.abortRun();
      resolve('aborted');
    };
  });
  if (options.signal?.aborted) return abortedResult(agent.state);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const running = agent.runAgent({ forwardedProps: options.forwardedProps }, subscriber);
    running.catch(() => {}); // an abort settles us first; the late rejection is expected
    const run = await Promise.race([running, aborted]);
    if (run === 'aborted') return abortedResult(agent.state);
    if (failure) return { ok: false, aborted: false, error: failure, state: agent.state };
    return { ok: true, result: run.result, state: agent.state, messages: agent.messages };
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return abortedResult(agent.state);
    if (failure) return { ok: false, aborted: false, error: failure, state: agent.state };
    const message = error instanceof Error ? error.message : 'The agent could not be reached.';
    return { ok: false, aborted: false, error: { code: 'network', message }, state: agent.state };
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
