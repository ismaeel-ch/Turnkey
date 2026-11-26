# ADR 2: One agent step per request

Status: accepted. Implementation: Built. Each Live agent turn is one run of the server's step graph.

## Context

A request on Vercel's free plan may run five minutes at most. A build is six to fifteen model calls, and Live also runs the Tester, reviewers and team agents. One long request would hit the limit and could not show progress.

## Decision

The browser drives the workflow and asks the server for one agent step at a time. `POST /api/llm` takes one prompt and streams one answer (`src/app/api/llm/route.ts`). The orchestrator in `src/workspace/line.ts` decides what to ask next, checks the answer, and sends work back.

## Consequences

- No request is long. A stopped or reloaded build loses only the step in progress, and the app says so on reload.
- The guard rails see each call and can refuse one (rate, daily cap, prompt size) without breaking a build half-way in a hidden way: the build stops and says why.
- The workflow lives in the browser, so the browser must stay open during a build.
- The agent step is a LangGraph run on the server (draft, validate, repair, at most three model calls, `src/server/graph/step`), reached through agent `step` in the CopilotKit runtime. An app team run is one request too; a pause ends it and a second request resumes from a snapshot.

Where to look: `src/app/api/llm/route.ts`, `src/workspace/line.ts`, section 4 of the overview.
