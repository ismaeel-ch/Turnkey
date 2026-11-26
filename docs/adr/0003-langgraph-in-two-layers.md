# ADR 3: LangGraph in two layers

Status: accepted. Implementation: Built. Every build runs through the workflow graph in the browser (`src/platform/orchestrator`); each Live agent step runs as a graph on the server (`src/server/graph/step`), and each app team as a graph compiled from its definition (`src/server/graph/team`).

## Context

The deck lists LangGraph as an optional toolkit. Turnkey has two kinds of orchestration. One is the build workflow, which the owner can edit on the canvas (stations, approvals, send-backs, added steps). The other is an app's agent team, which is a definition written by the Backend agent. Both started as plain async code in `src/workspace`.

## Decision

Use LangGraph at two levels. On the server, each agent step is a small graph (draft, validate against a schema, repair), and an app's team is a graph compiled from the team definition, with tool calls to public sources. In the browser, the build workflow is compiled from the workflow definition into a graph (`@langchain/langgraph/web`), so the canvas the owner edits is the graph that runs.

## Consequences

- Handoffs, interrupts for approvals and retries become named, testable graph pieces instead of hand-written loops.
- Risk: a second orchestrator next to a tested one. So the graph ships behind a switch (`window.__turnkeyOptions`) and the classic orchestrator stays the default until the graph passes every browser flow.
- If time runs out, the product still works: the classic orchestrator is complete. This is stated in the plan's cut order.
- The workflow graph reproduces the classic loop event for event; its README lists that order, and its tests check it.
- The browser flows that passed on the classic loop pass on the graph.

Where to look: `docs/PLAN.md` decision 3 and section 7; `src/platform/orchestrator/README.md`; work packages 05, 06, 09, 16.
