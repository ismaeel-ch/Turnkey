# AG-UI stream

Turnkey's agents run inside the Next.js route `/api/copilotkit` (CopilotKit's v2 runtime, in process) and talk to the
browser as an AG-UI event stream over server-sent events. The workspace uses its own UI; it reads the stream with a
small client and does not use CopilotKit's UI components.

```
browser  runAgent("step", …)          src/platform/agui/client.ts
   │  POST /api/copilotkit/agent/<id>/run   body: AG-UI RunAgentInput (forwardedProps = the agent's request)
   ▼
route    limiter (POST only) → CopilotKit runtime → agent registry      src/app/api/copilotkit, src/server/agui/registry.ts
   ▼
agent    GraphAgent runs one work function and reports through a sink   src/server/agui/graph-agent.ts
   │  SSE: RUN_STARTED … RUN_FINISHED | RUN_ERROR
   ▼
browser  callbacks (step, text, tool call, tool result, state, custom) + one final result
```

Other runtime endpoints: `GET /api/copilotkit/info` lists the agents.

## Agents

| Id        | What                                                  | Where                                   |
| --------- | ----------------------------------------------------- | --------------------------------------- |
| `default` | the spike's Architect (CopilotKit `BuiltInAgent`)     | `src/server/agui/registry.ts`           |
| `step`    | one agent step as a checked graph run                 | `src/server/graph/step` (agent-graphs)  |
| `team`    | an app's agent team as a graph run                    | `src/server/graph/team` (team-graph)    |
| `echo`    | demo, needs no model; only when `LLM_PROVIDER=mock`   | `src/server/agui/echo-agent.ts`         |

Add an agent with `registerAgent(id, loader)` in the registry. The loader runs once, on the first request that needs
the agent; a loader that throws is logged and skipped, so one broken agent does not stop the others.

## Sink call to AG-UI event

A work function receives an `AgentSink`. Every call below is ignored once the run has ended.

| Sink call                         | AG-UI events                                                                    | Notes                                                              |
| --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| (run begins)                      | `RUN_STARTED`                                                                   | Always first, emitted by `GraphAgent`, with the request's ids.     |
| `step(name)`                      | `STEP_FINISHED` (previous step, if any), `STEP_STARTED`                         | Open text and tool calls are closed first.                         |
| `endStep()`                       | `STEP_FINISHED`                                                                 |                                                                    |
| `text(delta, {messageId?})`       | `TEXT_MESSAGE_START` (first time), `TEXT_MESSAGE_CONTENT`                       | A different `messageId` closes the open message and starts a new one. Empty deltas are skipped. |
| `endText()`                       | `TEXT_MESSAGE_END`                                                              | Also sent automatically before a tool call, a step change or the end. |
| `toolCall(name, args, {id?})`     | `TOOL_CALL_START`, `TOOL_CALL_ARGS` (args as JSON), `TOOL_CALL_END`             | Returns the call id.                                               |
| `toolResult(id, result)`          | `TOOL_CALL_RESULT`                                                              | Objects are sent as JSON text.                                     |
| `state(patch)`                    | `STATE_DELTA`                                                                   | JSON Patch (RFC 6902). An empty patch sends nothing.               |
| `snapshot(state)`                 | `STATE_SNAPSHOT`                                                                |                                                                    |
| `custom(name, value)`             | `CUSTOM`                                                                        | For things like `issues` that have no event of their own.          |
| `finish(result)`                  | open blocks closed, then `RUN_FINISHED` with `result`                           | The first of `finish` and `fail` wins.                             |
| `fail(code, message)`             | open blocks closed, then `RUN_ERROR`                                            |                                                                    |
| work returns without `finish`     | `RUN_FINISHED` (no result)                                                      |                                                                    |
| work throws                       | `RUN_ERROR` with code `agent_error` and the error's message                     | No stack trace is sent.                                            |
| caller disconnects                | nothing more is sent; `sink.signal` aborts                                      | Pass `sink.signal` to model calls so they stop.                    |

A LangGraph run is mapped by the graph's own module: it calls the sink from its node and stream callbacks (node start
and end become `step`, model tokens become `text`, tool nodes become `toolCall` and `toolResult`, state updates
become `state`).

## Browser client

```ts
import { runAgent } from "@/platform/agui";

const controller = new AbortController();
const run = await runAgent("step", {
  forwardedProps: { prompt, tier: "default" },   // the agent's own request
  signal: controller.signal,                      // controller.abort() stops the run
  onStepStarted: (name) => …,
  onText: (delta, messageId, soFar) => …,
  onToolCall: ({ id, name, args }) => …,
  onToolResult: ({ id, content }) => …,
  onState: (state) => …,
  onCustom: (name, value) => …,
  onEvent: (event) => …,                          // every raw event, for the debug drawer
});
// run is { ok: true, result, state, messages }
//     or { ok: false, aborted, error: { code, message }, state }
```

It never throws: a refused request, a dropped connection, `RUN_ERROR` and an abort all come back as `ok: false`.

## Tests

- `tests/unit/agui-graph-agent.test.ts`: every sequence `GraphAgent` can produce passes the official event schemas
  (`@ag-ui/core` `EventSchemas`) and the protocol's state machine (`verifyEvents` from `@ag-ui/client`).
- `tests/unit/agui-client.test.ts`: the browser client against fake streams.
- `tests/unit/agui-route.test.ts`: the route handler called with a `Request` for the `echo` agent, and the client
  through that route.
