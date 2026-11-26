# ADR 4: AG-UI through CopilotKit's runtime

Status: accepted. Implementation: Built. Live builder agents run as agent `step` in the runtime; team runs stream the same AG-UI events from `/api/agent/team`. The chat panel is Turnkey's own (Fluent), not CopilotKit's components.

## Context

The spike (`/spike`) showed CopilotKit's v2 runtime running an agent in process inside a Next.js route handler, with a streamed tool call updating shared state over AG-UI. The project instructions name this stack. The workspace already has its own UI and its own event vocabulary, modelled on AG-UI (`RUN_STARTED`, `STEP_STARTED`, `STATE_DELTA`, `CUSTOM` and so on).

## Decision

Wrap each LangGraph graph as an AG-UI agent (an `AbstractAgent` subclass that runs a compiled graph and emits AG-UI events) and register it in the CopilotKit runtime at `/api/copilotkit`, next to the spike's `default` agent. The workspace talks to the runtime with the AG-UI client and keeps its own components, without CopilotKit's chat components.

## Consequences

- One event protocol from the server to the Debug drawer, the timeline and the chat.
- No separate Python server. Everything deploys as one Next.js project.
- The libraries change often, so each agent working on it must read the installed version first (rule in `CLAUDE.md`).
- The registry serves `default` (the spike's Architect), `step`, `team`, and an `echo` agent when `LLM_PROVIDER=mock`. Server events and the browser's own build events land on one activity bus that the Agents panel reads.
- The runtime route goes through the same rate limits as `/api/llm`, because every run spends budget.

Where to look: `src/app/api/copilotkit/`, `src/server/agui/`, `src/platform/agui/`, [`docs/architecture/ag-ui.md`](../architecture/ag-ui.md), `docs/PLAN.md` decision 4.
