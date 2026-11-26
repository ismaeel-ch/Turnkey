# ADR 2: One agent step per request

Status: accepted. Implementation: Built for the model route; the server-side step graph is planned (WP-05).

## Context

A request on Vercel's free plan may run five minutes at most. A build is six to fifteen model calls, and Live also runs the Tester, reviewers and team agents. One long request would hit the limit and could not show progress.

## Decision

The browser drives the workflow and asks the server for one agent step at a time. `POST /api/llm` takes one prompt and streams one answer (`src/app/api/llm/route.ts`). The orchestrator in `src/workspace/line.ts` decides what to ask next, checks the answer, and sends work back.

## Consequences

- No request is long. A stopped or reloaded build loses only the step in progress, and the app says so on reload.
- The guard rails see each call and can refuse one (rate, daily cap, prompt size) without breaking a build half-way in a hidden way: the build stops and says why.
- The workflow lives in the browser, so the browser must stay open during a build.
- Planned: the agent step as a LangGraph run on the server (draft, validate, repair, at most three attempts, WP-05), reached through the CopilotKit runtime (WP-08, WP-16).

Where to look: `src/app/api/llm/route.ts`, `src/workspace/line.ts`, section 4 of the overview.
