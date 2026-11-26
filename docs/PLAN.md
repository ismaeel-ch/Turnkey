# Turnkey build plan

Written Thu 26 Nov 2026, 21:00 PKT. Owner: the supervisor agent. Every agent reads this before starting.

- **Goal:** everything in the prototype works end to end on the live Vercel URL, with real agents behind it,
  inside one day of work.
- **Self-set finish:** Fri 27 Nov, 20:00 PKT. **Hard deadline:** Mon 30 Nov 2026, 14:00 PKT (submissions close).
- **What is judged** (five criteria, 1 to 10 each, equal weight). Every work package names the ones it serves.

| Tag | Criterion                                         | What the judges are told to look for                                                                                    |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| C1  | Completeness, including multi-agent orchestration | works end to end; agents with distinct roles hand work to each other and check each other; each agent's steps are shown |
| C2  | Technical execution                               | clean build, sensible agents, key kept out of the code                                                                  |
| C3  | Creativity and uniqueness                         | a fresh, specific idea                                                                                                  |
| C4  | Business value                                    | someone at SSI or a client would really use it                                                                          |
| C5  | Presentation and live product                     | live, public, easy to demo                                                                                              |

Before scoring there is a pass-or-out filter: own individual work, no client or internal data, no key in the code,
live on a public URL, safe AI-agent settings, agentic and not a single prompt, works end to end, stays up, public
repo that matches the app. `docs/hackathon/criteria.md` tracks the evidence for each.

## 1. Where we start

The prototype is a single HTML page: 26 plain-script modules (about 900 KB) that hold the whole product: the
workflow canvas, the six builder agents and their checks, the browser runtime (SQLite, role-guarded endpoints, 14
view types, dashboards), app agent teams and their rooms, the Tester and its repair loop, changes from chat,
releases, share links and the app-only view. It was verified by 286 browser checks with a stand-in model.

**Spike (done, pull request 1, by another session):** a streamed tool call from the model updates shared canvas
state, through CopilotKit's v2 runtime with an in-process agent and LiteLLM. It proved the stack the project
instructions name: Next.js 16, CopilotKit on AG-UI, no separate server. It lives on at `/spike`.

**Foundation (done, the next pull request):** the prototype's modules now run unchanged in the same Next.js app,
drawn by React 19. `src/platform/compat` puts React behind the names the modules already use (`html`, `render`,
hooks), so the built bundle is byte-identical to the prototype's script. All 286 checks pass against the React app.
A model route (`POST /api/llm`) and a health route exist, so Live mode works as soon as a key is set on Vercel.

## 2. Architecture

```
Browser                                              Server (Next.js route handlers on Vercel)
───────────────────────────────────────────          ─────────────────────────────────────────────
src/legacy    workspace UI, runtime, checks           /api/health         up? model configured? probes
src/platform  compat layer, boot, model client        /api/llm            one guarded model call, streamed
              orchestrator: the build workflow        /api/copilotkit     CopilotKit runtime (AG-UI), agents in process:
              as a LangGraph graph (browser)            agent `default`     the spike's Architect
              AG-UI client, storage, PWA                agent `step`        one agent step as a LangGraph run:
SQLite (sql.js) + app state in browser storage                              draft → validate → repair
                                                        agent `team`        an app's agent team as a LangGraph run:
                                                                            agents hand over, call tools, are checked
                                                      /api/connectors/*   public sources (Wikipedia, World Bank,
                                                                           OpenAlex, arXiv, PatentsView)
                                                      src/server/llm      provider gateway: LiteLLM, OpenAI-compatible,
                                                                           Anthropic, Claude Code CLI (local), mock
                                                      src/server/guard    rate limits, spend cap, prompt policy
```

Decisions, with the reason for each. Longer versions go in `docs/adr/`.

1. **State and SQLite stay in the browser.** Vercel's free plan keeps nothing between requests, and the owner
   asked for data that is still there after a reload. The server is stateless.
2. **One agent step per request.** A request may run five minutes at most on the free plan, and a build is 6 to 15
   model calls. The browser drives the workflow and asks the server for one step at a time, so no request is long.
3. **LangGraph in two layers.** On the server, each agent step is a small graph (draft, validate against a schema,
   repair, at most three attempts), and an app's agent team is a graph compiled from the team's definition, with
   tool calls to public sources. In the browser, the build workflow (stations, gates, send-backs, approvals, the
   owner's added steps) is compiled from the workflow definition into a graph, so the canvas the owner edits is the
   graph that runs. `@langchain/langgraph/web` is the browser entry point.
4. **AG-UI through CopilotKit's runtime.** The spike showed CopilotKit's v2 runtime running agents in process in
   a route handler. The LangGraph graphs are wrapped as AG-UI agents (`AbstractAgent` subclasses that run a
   compiled graph and emit AG-UI events) and registered in that same runtime at `/api/copilotkit`. The workspace
   keeps its own UI and talks to the runtime through the AG-UI client, without CopilotKit's chat components.
5. **Definitions, not code.** Agents return JSON definitions. A fixed runtime runs them. Nothing a model writes is
   executed as code, and a share link is treated as untrusted input.
6. **Any model key.** `src/server/llm` hides the provider. LiteLLM is the default because the hackathon requires
   it; OpenAI-compatible, Anthropic and the Claude Code CLI (local testing only) are alternatives; `mock` needs no
   key and makes the whole server path testable in CI.
7. **JSON first, tool calling where it exists.** The hackathon guide warns that tool calling works only on some
   gateway models. Every agent works by returning one JSON object that code acts on. Native tool calls are used
   only after a probe shows they work.
8. **The legacy modules are not rewritten.** New behaviour is added beside them in `src/platform` and reached
   through a few named seams (section 6).

### Contracts every agent builds against

Environment variables, read only in server code:

| Name                                                                                                                               | Meaning                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`                                                                             | the hackathon gateway (names fixed by the hackathon guide)        |
| `LITELLM_MODEL_FAST`                                                                                                               | optional cheap model for the Quick setting                        |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MODEL_FAST`, `OPENAI_BASE_URL`                                                           | any OpenAI-compatible service                                     |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_MODEL_FAST`                                                                     | Anthropic directly                                                |
| `LLM_PROVIDER`                                                                                                                     | force one: `litellm`, `openai`, `anthropic`, `claude-code`, `mock` |
| `LLM_TOOL_MODE`                                                                                                                    | `auto` (default), `native`, `json`                                |
| `LLM_RATE_PER_MINUTE`, `LLM_GLOBAL_PER_MINUTE`, `LLM_DAILY_CALL_CAP`, `LLM_MAX_PROMPT_CHARS`, `LLM_MAX_OUTPUT_TOKENS`, `LIVE_MODE` | guard rails (`src/server/guard/limits.ts`)                        |
| `PATENTSVIEW_API_KEY`                                                                                                              | optional, for the PatentsView connector                           |

npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e [-- flows]`, `check`,
`check:secrets`, `build:legacy`, `format`. Do not rename them: CI and the hooks call them.

Model tiers: `default` (careful) and `quick` (cheap). Provider interface: `src/server/llm/types.ts`.

`POST /api/llm` takes `{ prompt, tier }` and answers newline-delimited JSON: `{"type":"delta","text"}` any number
of times, then `{"type":"done","truncated"}` or `{"type":"error","code","message"}`. Refusals are JSON with a
`code`: `not_configured`, `rate_limited`, `budget`, `bad_request`.

Agents `step` and `team` are registered in the CopilotKit runtime at `/api/copilotkit` (the route the spike
created). Each takes an AG-UI `RunAgentInput` and answers an AG-UI event stream. What goes in `forwardedProps` and
`state` is defined in `src/shared/agent-contract.ts`, owned by the agent-graphs agent and agreed with agui-stream
and team-graph in their issues before code depends on it. The runtime route and the agent registry
(`src/server/agui/registry.ts`) belong to agui-stream; agent-graphs and team-graph export agent factories.

## 3. Milestones and releases

| Milestone               | Contains                                                                                                       | Tag      | Target (PKT) |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| M1 React app live       | foundation, CI, all 286 checks green in CI, health check on the live URL                                       | `v0.1.0` | Thu 23:30    |
| M2 Agents on the server | gateway, guard rails, agent-step graph, team graph, connectors, AG-UI stream, storage, PWA, docs               | `v0.2.0` | Fri 07:00    |
| M3 Wired end to end     | Live mode runs through the server graphs, the workflow graph drives builds, live checks pass on the Vercel URL | `v0.3.0` | Fri 14:00    |
| M4 Submission           | hardening, diagrams, criteria evidence, summary text, final checks                                             | `v1.0.0` | Fri 20:00    |

A release is cut only when a milestone's issues are closed and `main` is green and deployed. Tags are semantic
versions. Release notes list the merged pull requests.

## 4. Work packages

Each package is one GitHub issue: `WP-nn` is issue number nn + 1 (WP-01 is #2, WP-16 is #17). Mission control is #18. Paths under "Owns" belong to
that agent alone. Models: the supervisor runs on Opus, workers on Sonnet or Haiku.

| WP  | Agent              | Model  | Owns                                                                                                                       | Delivers                                                                                                                                                                                                                                                                 | Serves   | Needs               |
| --- | ------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------- |
| 01  | supervisor         | Opus   | merges, `docs/STATUS.md`, any file when integrating                                                                        | reviews and merges pull requests, keeps `main` green and deployed, resolves conflicts, cuts releases, posts status on the Mission control issue                                                                                                                          | all      |                     |
| 02  | react-port         | Sonnet | `src/platform/compat/**`, `src/platform/boot.ts`, `src/platform/LegacyApp.tsx`, `tests/e2e/**`, `scripts/build-legacy.mjs` | all 8 browser flows green in CI as a matrix; React-specific checks (no console errors, keyboard, focus); fixes for any gap the compat layer has                                                                                                                          | C1 C2 C5 |                     |
| 03  | backend-gateway    | Sonnet | `src/server/llm/**`, `src/lib/model.ts`, `src/app/api/llm/**`, `src/app/api/health/**`                                     | one provider configuration for everything (the gateway, the spike's AI SDK model, the graphs' LangChain model); Anthropic and Claude Code CLI providers; retries with backoff; tool-call support with a JSON fallback and a probe that picks the mode; a role-aware mock | C1 C2    |                     |
| 04  | security-guard     | Sonnet | `src/server/guard/**`, `src/proxy.ts`, security headers in `next.config.ts`, `scripts/check-secrets.mjs`, `SECURITY.md`    | prompt policy (only Turnkey's agent prompts are relayed), stronger limits, request validation helpers, content security policy that still allows SQLite's WebAssembly, the secrets scan                                                                                  | C2       |                     |
| 05  | agent-graphs       | Sonnet | `src/server/graph/step/**`, `src/server/graph/shared/**`, `src/server/agents/**`, `src/shared/**`                          | the agent-step graph in LangGraph (draft, validate, repair, at most 3 attempts), the role registry with a zod schema per builder agent, exported as an agent factory for the runtime                                                                                     | C1 C2    | 03 (interface only) |
| 06  | team-graph         | Sonnet | `src/server/graph/team/**`                                                                                                 | a LangGraph graph compiled from an app's team definition: agents in order, tool calls to connectors, a checking agent that can send work back once, a pause for a person; exported as an agent factory; works for the three quest apps and the bidding desk              | C1 C3    | 05 shared types, 07 |
| 07  | connectors         | Haiku  | `src/server/connectors/**`, `src/app/api/connectors/**`                                                                    | Wikipedia, World Bank, OpenAlex, arXiv, PatentsView: typed, validated, cached, time-limited, with recorded fixtures for tests                                                                                                                                            | C1 C4    |                     |
| 08  | agui-stream        | Sonnet | `src/server/agui/**`, `src/platform/agui/**`, `src/app/api/copilotkit/**`                                                  | the bridge from a LangGraph run to AG-UI events as an in-process agent class, the agent registry in the CopilotKit runtime (keeping the spike's `default` agent), a browser client that runs an agent and consumes its events; contract tests                            | C1 C2    |                     |
| 09  | workflow-graph     | Sonnet | `src/platform/orchestrator/**`                                                                                             | the build workflow as a LangGraph graph compiled from a workflow definition (stations, gates, send-backs, approvals as interrupts, added steps); a pure library with tests, not yet wired                                                                                | C1 C3    |                     |
| 10  | database           | Sonnet | `src/platform/storage/**`, `src/shared/sql/**`, `docs/architecture/data.md`                                                | storage adapter (IndexedDB with the current localStorage format still readable), export and import of an app's SQLite file, a validator for generated table definitions, data-model diagrams                                                                             | C2 C4    |                     |
| 11  | pwa-install        | Sonnet | `src/app/manifest.ts`, `src/app/a/**`, `src/app/icon*`, `public/sw.js`, `public/icons/**`, `src/platform/pwa/**`           | a real install: web manifest, service worker that keeps the shell, SQLite and saved builds offline, per-app manifest and icon routes drawn from the app's icon data                                                                                                      | C5 C4    |                     |
| 12  | devops-ci          | Haiku  | `.github/**`, `scripts/ci/**`, `docs/process/**`, `vercel.json`                                                            | CI hardening, release workflow, issue and pull request templates, CODEOWNERS, dependency updates, the release checklist                                                                                                                                                  | C2       |                     |
| 13  | docs-architect     | Sonnet | `README.md`, `docs/architecture/**`, `docs/adr/**`, `docs/hackathon/**`                                                    | README, architecture diagrams (Mermaid), ADRs, the criteria evidence page, the use-case page, the submission summary                                                                                                                                                     | C5 C4 C2 |                     |
| 14  | compliance-auditor | Haiku  | `docs/hackathon/checklist.md`, `THIRD_PARTY_NOTICES.md`                                                                    | rule-by-rule audit of the repo and the live URL, repeated after each milestone; opens an issue for every gap                                                                                                                                                             | C2       |                     |
| 15  | qa-unit            | Haiku  | `tests/unit/**` (files for code that has no owner-written test), `vitest.config.ts`                                        | unit tests for the foundation code, coverage report, test helpers                                                                                                                                                                                                        | C2       |                     |
| 16  | integration        | Sonnet | `src/legacy/**` (smallest possible seams), `src/platform/bridge/**`, `src/platform/model-client.ts`                        | wave 2: Live mode goes through agent `step` at `/api/copilotkit`; team runs go through agent `team`; the workflow graph drives builds behind a switch; the debug drawer shows server events                                                                              | C1       | 05 06 08 09         |

Wave 1 is packages 01 to 15, all at once. Wave 2 is package 16 and whatever wave 1 left open. The supervisor decides.

### Definition of done, for every package

1. The issue's acceptance list is met and says how each item was verified.
2. `npm run check` passes locally. CI is green on the pull request, including the browser flows.
3. New code has tests. No file outside the package's "Owns" list changed, except `package.json` additions.
4. With no model configured the app still works; with `LLM_PROVIDER=mock` the new server path works.
5. No secret, no client data, no `NEXT_PUBLIC_` variable.
6. The pull request names its issue (`Closes #n`), is squash-merged, and its branch is deleted.

## 5. Process

- **Branches:** `feat/…`, `fix/…`, `docs/…`, `chore/…`, `test/…`. One issue, one branch.
- **Commits:** imperative subject under 72 characters, a body that says why. End with the attribution trailers your
  environment gives you.
- **Pull requests:** small. Title `WP-nn: what changed`. Body: what, why, how it was verified, `Closes #n`.
- **Merging:** squash, by the supervisor (or auto-merge once CI is green). Never push to `main`.
- **CI:** `.github/workflows/ci.yml` runs the secrets scan, lint, typecheck, unit tests, a production build and the
  browser flows on a pull request into `main` only once it is out of draft and labelled `ready-to-merge`, to save
  Actions minutes. Nothing runs on pushes to `main`.
- **CD:** publishing a GitHub release deploys that tag to production (`.github/workflows/release.yml`, Vercel CLI).
  Vercel's Git integration is off (`vercel.json`), so merges and pushes never deploy. See docs/process/deploy.md.
- **Labels:** `ready-to-merge`, `wp`, `area:*`, `crit:C1`…`crit:C5`, `wave:1`, `wave:2`, `blocked`, `bug`.
- **Status:** the supervisor comments on the Mission control issue at least every hour: merged, open, blocked, next.

### Working in parallel on one machine

- Shared dependencies are already installed: LangGraph (`@langchain/langgraph`, `@langchain/core`), AG-UI
  (`@ag-ui/core`, `@ag-ui/client`, `@ag-ui/encoder`), CopilotKit, zod, and for tests jsdom, fake-indexeddb and
  vitest coverage. Add another dependency only if you must, in a commit of its own, because every change to the
  lockfile conflicts with every other open pull request.
- Each checkout already has `node_modules` (a hard-linked copy). Run `npm ci` only after the lockfile changed.
- Each agent works in its own checkout: `git -C /home/claude/turnkey worktree add /home/claude/wt/<agent> -b <branch> origin/main`.
- Wrap builds and browser tests: `scripts/heavy.sh npm run build`. Only react-port, integration and the supervisor
  run browser flows locally; everyone else relies on CI for them.
- Give the test server its own port: `PORT=31nn` with your package number.
- The git remote accepts two transfers at a time. If a push or fetch is refused with 429, wait 10 seconds and retry.
- Rebase on `origin/main` before opening a pull request and again if it conflicts.

## 6. Seams between the workspace and the platform

The legacy modules reach the outside world through a handful of names. New work plugs in here, not into the modules.

| Seam                                                                                            | Today                                              | What plugs in                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `window.claude.use('sample')` → `(prompt, { modelTier, signal, onText }) → { text, truncated }` | `src/platform/model-client.ts`, calling `/api/llm` | the AG-UI client running agent `step` at `/api/copilotkit` (WP-16) |
| `window.claude.use('downloads')` → `{ save({ filename, data }) }`                               | browser download                                   | unchanged                                                          |
| `window.htmPreact`, `window.React`, `window.ReactDOM`, `window.ReactFlow`                       | React, through the compat layer                    | unchanged                                                          |
| `window.initSqlJs`                                                                              | sql.js WebAssembly from `/vendor`                  | unchanged                                                          |
| browser storage keys `formwork:v1:state`, `formwork:v1:db:<appId>`                              | localStorage                                       | the storage adapter (WP-10)                                        |
| `window.__formwork`                                                                             | read-only test hook: state, logs, workflow helpers | reading state for the orchestrator and the debug stream            |
| `window.__turnkeyOptions`                                                                       | `{ canvas: false }` shows the plain line           | further switches, for example `{ orchestrator: 'graph' }`          |

If a feature cannot be built through a seam, WP-16 adds the smallest new seam to `src/legacy` and documents it here.

## 7. Risks and what we do about them

| Risk                                                                                     | Response                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nobody building this can call the real gateway: the key exists only in Vercel's settings | `mock` provider end to end in CI; `/api/health?probe=1` checks the real key on the live URL; the owner runs one live build after M1 and again after M3                                              |
| The budget is 25 dollars in total and also covers judging                                | caps in `src/server/guard`; Demo mode needs no model; Quick setting uses the cheap model; `LIVE_MODE=off` as a switch                                                                               |
| Tool calling may not work on the gateway's models                                        | JSON-first agents; probe before using native tools                                                                                                                                                  |
| Many agents break each other's work                                                      | folder ownership, small pull requests, required CI, one supervisor merging                                                                                                                          |
| 100 Vercel deployments a day                                                             | only `main` deploys; the supervisor merges in batches when the count gets high                                                                                                                      |
| Vercel's free plan may not deploy commits whose author is not the account owner          | pull requests are squash-merged through GitHub so the commit on `main` carries the owner's identity; if deployments still do not start, the owner adds a deploy hook (see `docs/process/deploy.md`) |
| The workflow graph destabilises builds                                                   | it ships behind a switch; the classic orchestrator stays the default until the graph passes every flow                                                                                              |
| Time                                                                                     | cut order: wave 2 workflow-graph wiring, PWA offline, IndexedDB, PatentsView. Never cut: live multi-agent build, visible agent steps, one quest app end to end, the Tester's repair loop            |
