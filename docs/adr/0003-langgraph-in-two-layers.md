# ADR 3: LangGraph in two layers

Status: accepted. Implementation: Planned (WP-05, WP-06, WP-09). The classic orchestrator is built and is the default.

## Context

The deck lists LangGraph as an optional toolkit. Turnkey has two kinds of orchestration. One is the build workflow, which the owner can edit on the canvas (stations, approvals, send-backs, added steps). The other is an app's agent team, which is a definition written by the Backend agent. Both are plain async code in `src/legacy` today.

## Decision

Use LangGraph at two levels. On the server, each agent step is a small graph (draft, validate against a schema, repair), and an app's team is a graph compiled from the team definition, with tool calls to public sources. In the browser, the build workflow is compiled from the workflow definition into a graph (`@langchain/langgraph/web`), so the canvas the owner edits is the graph that runs.

## Consequences

- Handoffs, interrupts for approvals and retries become named, testable graph pieces instead of hand-written loops.
- Risk: a second orchestrator next to a tested one. So the graph ships behind a switch (`window.__turnkeyOptions`) and the classic orchestrator stays the default until the graph passes every browser flow.
- If time runs out, the product still works: the classic orchestrator is complete. This is stated in the plan's cut order.
- Until these merge, this repository's documents describe the classic orchestrator as what exists.

Where to look: `docs/PLAN.md` decision 3 and section 7; work packages 05, 06, 09, 16.
