/**
 * GraphAgent: the base class for Turnkey's in-process AG-UI agents.
 *
 * A subclass (or a caller of `graphAgent(...)`) supplies one async function. That function does the work and reports
 * through an `AgentSink`; GraphAgent turns the calls into a valid AG-UI event sequence:
 * RUN_STARTED first, then whatever the sink calls produce, then exactly one of RUN_FINISHED or RUN_ERROR.
 * Open steps, text messages and tool calls are closed for you, so the sequence always passes the protocol's checks.
 * Table of call to event: docs/architecture/ag-ui.md
 */
import { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, JsonPatchOperation, RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";

export type { JsonPatchOperation };

/** What the work function reports through. All methods are safe to call after the run has ended: they do nothing. */
export interface AgentSink {
  /** The request this run was started with (messages, state, forwardedProps). */
  readonly input: RunAgentInput;
  /** Aborted when the caller goes away. Pass it to anything that can be cancelled. */
  readonly signal: AbortSignal;
  /** True once the run has finished, failed or been aborted. */
  readonly closed: boolean;
  /** Start a named step. Finishes the previous step first. */
  step(name: string): void;
  /** Finish the open step without starting another. */
  endStep(): void;
  /** Append streamed text to the assistant message. Opens one if needed. Empty deltas are ignored. */
  text(delta: string, opts?: { messageId?: string }): void;
  /** Close the open assistant message, so the next text() starts a new one. */
  endText(): void;
  /** Announce a tool call and its arguments (an object, or an already serialised JSON string). Returns the call id. */
  toolCall(name: string, args?: unknown, opts?: { id?: string; parentMessageId?: string }): string;
  /** Report what a tool call returned. Objects are serialised as JSON. */
  toolResult(toolCallId: string, result: unknown): void;
  /** Change shared state with a JSON Patch (RFC 6902) list. */
  state(delta: JsonPatchOperation[]): void;
  /** Replace shared state whole. */
  snapshot(state: unknown): void;
  /** A named event for the debug drawer or anything else that does not fit the other calls. */
  custom(name: string, value: unknown): void;
  /** End the run with a result. The first of finish() and fail() wins. */
  finish(result?: unknown): void;
  /** End the run with an error. The first of finish() and fail() wins. */
  fail(code: string, message: string): void;
}

export type AgentWork = (sink: AgentSink) => Promise<void> | void;

const newId = (): string => globalThis.crypto.randomUUID();

const toJson = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify(String(value));
  }
};

/** Builds the sink for one run. Exported for tests. */
export function createSink(
  input: RunAgentInput,
  signal: AbortSignal,
  emit: (event: BaseEvent) => void,
  end: () => void,
): AgentSink {
  let closed = false;
  let step: string | null = null;
  let messageId: string | null = null;
  const openTools = new Set<string>();

  const send = (event: BaseEvent) => {
    if (!closed) emit({ ...event, timestamp: Date.now() });
  };
  const closeText = () => {
    if (messageId) send({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
    messageId = null;
  };
  const closeTools = () => {
    for (const id of openTools) send({ type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent);
    openTools.clear();
  };
  const closeStep = () => {
    if (step !== null) send({ type: EventType.STEP_FINISHED, stepName: step } as BaseEvent);
    step = null;
  };
  const closeAll = () => {
    closeText();
    closeTools();
    closeStep();
  };
  const stop = (event: BaseEvent) => {
    if (closed) return;
    closeAll();
    send(event);
    closed = true;
    end();
  };

  return {
    input,
    signal,
    get closed() {
      return closed;
    },
    step(name) {
      if (closed) return;
      closeAll();
      step = name;
      send({ type: EventType.STEP_STARTED, stepName: name } as BaseEvent);
    },
    endStep() {
      if (closed) return;
      closeAll();
    },
    text(delta, opts) {
      if (closed || !delta) return;
      if (messageId && opts?.messageId && opts.messageId !== messageId) closeText();
      if (!messageId) {
        closeTools();
        messageId = opts?.messageId ?? newId();
        send({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
      }
      send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta } as BaseEvent);
    },
    endText() {
      if (!closed) closeText();
    },
    toolCall(name, args, opts) {
      const id = opts?.id ?? newId();
      if (closed) return id;
      closeText();
      send({
        type: EventType.TOOL_CALL_START,
        toolCallId: id,
        toolCallName: name,
        ...(opts?.parentMessageId ? { parentMessageId: opts.parentMessageId } : {}),
      } as BaseEvent);
      send({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: toJson(args ?? {}) } as BaseEvent);
      send({ type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent);
      return id;
    },
    toolResult(toolCallId, result) {
      if (closed) return;
      closeText();
      send({
        type: EventType.TOOL_CALL_RESULT,
        messageId: newId(),
        toolCallId,
        content: toJson(result),
        role: "tool",
      } as BaseEvent);
    },
    state(delta) {
      if (closed || delta.length === 0) return;
      send({ type: EventType.STATE_DELTA, delta } as BaseEvent);
    },
    snapshot(state) {
      if (!closed) send({ type: EventType.STATE_SNAPSHOT, snapshot: state } as BaseEvent);
    },
    custom(name, value) {
      if (!closed) send({ type: EventType.CUSTOM, name, value } as BaseEvent);
    },
    finish(result) {
      stop({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        ...(result === undefined ? {} : { result }),
      } as BaseEvent);
    },
    fail(code, message) {
      stop({ type: EventType.RUN_ERROR, code, message } as BaseEvent);
    },
  };
}

/** The error message a caller sees for something thrown inside the work function. Never includes a stack. */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 500) : "The agent stopped unexpectedly.";
}

/**
 * An in-process AG-UI agent that runs one work function per request.
 * The runtime clones registered agents for each request, so the work function is copied by clone().
 */
export class GraphAgent extends AbstractAgent {
  protected work: AgentWork;

  constructor(work: AgentWork, config?: { description?: string }) {
    super({ description: config?.description ?? "" });
    this.work = work;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const work = this.work;
    return new Observable<BaseEvent>((subscriber) => {
      const controller = new AbortController();
      let ended = false;
      const sink = createSink(
        input,
        controller.signal,
        (event) => {
          if (!ended) subscriber.next(event);
        },
        () => {
          if (!ended) {
            ended = true;
            subscriber.complete();
          }
        },
      );

      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        timestamp: Date.now(),
      } as BaseEvent);

      void (async () => {
        try {
          await work(sink);
          if (controller.signal.aborted) sink.fail("aborted", "The run was stopped.");
          else sink.finish();
        } catch (error) {
          if (controller.signal.aborted) sink.fail("aborted", "The run was stopped.");
          else sink.fail("agent_error", messageOf(error));
        }
      })();

      // The caller left: stop the work. Nothing more can be delivered.
      return () => {
        ended = true;
        controller.abort();
      };
    });
  }

  clone(): GraphAgent {
    const copy = super.clone() as GraphAgent;
    copy.work = this.work;
    return copy;
  }
}

/** Shorthand for an agent that is just a function. */
export function graphAgent(work: AgentWork, config?: { description?: string }): GraphAgent {
  return new GraphAgent(work, config);
}
