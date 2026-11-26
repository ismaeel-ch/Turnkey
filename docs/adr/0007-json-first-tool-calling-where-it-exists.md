# ADR 7: JSON first, tool calling where it exists

Status: accepted. Implementation: Built. The builder agents use JSON. The gateway's tool support (`src/server/llm/tools.ts`) uses native tool calls where the probe says they work and the JSON protocol otherwise; app team agents ask for a lookup in their JSON answer, and the team graph checks the request against the agent's tools and runs the connector.

## Context

The hackathon guide warns that tool calling works only on some gateway models. An agent that depends on it could fail on the model the key can reach.

## Decision

Every agent works by returning one JSON object that code acts on. Code, not the model, performs the actions: creating tables, calling endpoints, writing rows. Native tool calls are to be used only after a probe shows they work. `/api/health?probe=tools` makes one tool call to check; `LLM_TOOL_MODE` (`auto`, `native`, `json`) picks the way; `auto` probes once per provider and model and remembers.

## Consequences

- Agents work on any model that can write JSON, including the stand-in mock.
- Tool use appears in the interface as recorded tool calls (`toolCall` events for `set_tab_title`, `mount_views`, `run_sql`, connector calls) even though the model itself returns JSON.
- Less flexible than free tool use: an agent cannot decide on its own to call a tool the definition did not give it.
- The spike proves a streamed native tool call works through CopilotKit and the gateway where the model allows it.

Where to look: `src/workspace/line.ts` (`PROMPTS`, `toolCall`), `src/server/llm/tools.ts`, `src/app/api/health/route.ts`, `src/app/(spike)`.
