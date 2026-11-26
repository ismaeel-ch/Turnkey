# Architecture overview

This page shows how Turnkey is put together and how its agents work with each other. Every diagram is written in
Mermaid, so GitHub draws it from the text in this file.

**Status words used below.** _Built_ means it is in `main` and covered by tests. Everything on this page is built
unless it says _planned_. Updated 26 Nov 2026, after release v0.3.2.

Three facts to keep in mind while reading:

- The build is driven from the browser. The owner's workflow is compiled into a LangGraph graph
  (`src/platform/orchestrator`) that decides the order: stations, checks, send-backs, approvals, added steps, the
  Tester. The app's database lives in the browser too, so code there applies and checks each answer.
- In Live, every agent's turn runs on the server: the browser asks agent `step` in the CopilotKit runtime over AG-UI,
  and the server runs one small LangGraph graph (draft, validate against the role's schema, repair). An app's own
  agent team runs on the server as a LangGraph graph of its own, with lookups in public sources. In Demo, saved answers
  are replayed through the same path and no model is called.
- Code, not a model, decides whether an agent's answer is good enough.

Contents: [1 System context](#1-system-context) · [2 Containers](#2-containers) ·
[3 The build workflow](#3-the-build-workflow) · [4 One agent step](#4-one-agent-step) ·
[5 A team run: the fact-check app](#5-a-team-run-the-fact-check-app) · [6 A change from chat](#6-a-change-from-chat) ·
[7 Deployment pipeline](#7-deployment-pipeline) · [8 The agents at a glance](#8-the-agents-at-a-glance) ·
[9 The workflow as a graph](#9-the-workflow-as-a-graph) ·
[10 Guard rails on every model call](#10-guard-rails-on-every-model-call)

## 1. System context

Who uses Turnkey and what it talks to.

```mermaid
flowchart LR
  owner["Owner<br/>describes an app, watches the agents,<br/>approves, asks for changes"]
  user["App user<br/>opens a built app by share link"]
  subgraph turnkey["Turnkey (one Next.js project on Vercel)"]
    ws["Workspace in the browser<br/>and its server routes"]
  end
  gw["Claude models<br/>through a Claude API key (live site)<br/>or the LiteLLM gateway; key kept on the server"]
  pub["Public sources<br/>Wikipedia, World Bank, OpenAlex,<br/>arXiv, PatentsView"]
  gh["GitHub<br/>repository and CI"]
  vc["Vercel<br/>builds and hosts"]
  owner --> ws
  user --> ws
  ws -->|"one agent step per request"| gw
  ws -->|"team lookups, from the server"| pub
  gh -->|"published release"| vc
  vc -->|"deploys"| turnkey
```

Notes:

- With no model configured, saved builds and every screen still work (Demo mode). Live mode needs the gateway.
- In Live, an app's team agents look up public sources from the server (`src/server/graph/team/connector-tools.ts`
  over `src/server/connectors`). In Demo, the quest apps replay saved runs whose evidence is marked as sample data.
  The app says so on its About page ("What is real in this prototype").
- On the live site the model is reached with a Claude API key. The hackathon's LiteLLM gateway is supported by the
  same gateway code and switched on by environment variables (`src/server/llm/README.md`); the owner chose the API key
  on 26 Nov.

## 2. Containers

What runs where. The browser holds the product and its data. The server is stateless: it relays model calls and
enforces limits.

```mermaid
flowchart TB
  subgraph browser["Browser"]
    direction TB
    ws["Workspace<br/>src/workspace: canvas, chat, Agents panel,<br/>runtime for built apps, Tester, rooms"]
    orch["Workflow graph<br/>src/platform/orchestrator<br/>LangGraph (web): runs every build"]
    mc["Model client<br/>src/platform/model-client.ts<br/>runs agent step over AG-UI"]
    ts["Team stream<br/>src/workspace/team-stream.ts"]
    act["Activity bus<br/>src/platform/agui/activity.ts"]
    sqlite[("SQLite (sql.js, WebAssembly)<br/>one database per app")]
    store[("IndexedDB<br/>src/platform/storage: workspace,<br/>databases, backups")]
    ws --> orch
    orch --> mc
    ws --> ts
    mc --> act
    ts --> act
    ws --> sqlite
    ws --> store
  end
  subgraph server["Server: Next.js route handlers on Vercel (stateless)"]
    direction TB
    ck["/api/copilotkit<br/>CopilotKit runtime"]
    reg["AG-UI agent registry<br/>src/server/agui"]
    step["Agent step graph<br/>src/server/graph/step<br/>guard, draft, validate, repair"]
    team["Team graph<br/>src/server/graph/team<br/>agent, tools, check, pause"]
    tr["POST /api/agent/team<br/>AG-UI events over SSE"]
    schemas["Role schemas<br/>src/server/agents"]
    conn["Connectors<br/>src/server/connectors: Wikipedia, World Bank,<br/>OpenAlex, arXiv, PatentsView"]
    guard["Guard rails<br/>src/server/guard: prompt policy, rate limits,<br/>daily call and dollar caps, LIVE_MODE"]
    gateway["Model gateway<br/>src/server/llm: Claude API key, LiteLLM,<br/>OpenAI-compatible, Claude Code CLI (local), mock<br/>effort per tier, prompt caching, cost per call"]
    share["/api/share<br/>short links, src/server/share"]
    health["/api/health<br/>backend, commit, calls, spend"]
    ck --> guard
    tr --> guard
    ck --> reg --> step
    reg --> team
    tr --> team
    step --> schemas
    step --> gateway
    team --> gateway
    team --> conn
    health --> gateway
  end
  blob[("Vercel Blob<br/>shared apps only")]
  ext["Claude models"]
  mc -->|"AG-UI events (SSE)"| ck
  ts -->|"team run, resume after a pause"| tr
  ws -->|"share by short link"| share
  share --> blob
  gateway --> ext
```

Rules the layout enforces (also in `CLAUDE.md`): the browser never calls a model provider; nothing in `src/server` is
imported from `src/platform` or `src/workspace`; keys are read only in server code. `/api/llm` (one guarded model call)
and `/api/agent/step` (the step graph over plain HTTP) still exist beside the AG-UI route; the workspace uses the AG-UI
route.

The data model, storage and export are described in [`data.md`](data.md); the AG-UI events in [`ag-ui.md`](ag-ui.md).

## 3. The build workflow

One build, from one sentence to a working app. There are five builder agents (Researcher, Database, Backend, View
advisor, UI) and the Tester, which makes six agents with distinct jobs. The Orchestrator is code: `runBuild` in
`src/workspace/line.ts` compiles the owner's workflow into a LangGraph graph (`createRun`, `workflowFromFlow` from
`src/platform/orchestrator`) and gives it ports that run each station, ask the owner and run the Tester. Section 9
shows the graph.

The stations, in order: Research, Database, Backend, Views, Screens, Walkthrough, then the Tests step.
The UI agent owns two stations (Screens and Walkthrough). The diagram shows the owner's own steps that the screenshot
in the README shows: an approval gate after Backend and a "Normalise tables" step after Database.

```mermaid
sequenceDiagram
  autonumber
  actor Owner
  participant O as Orchestrator (code)
  participant R as Researcher
  participant D as Database
  participant B as Backend
  participant V as View advisor
  participant U as UI
  participant T as Tester
  participant DB as SQLite

  Owner->>O: one sentence describing the app
  O->>R: station 1, Research
  R-->>O: brief (roles, records, process, stories)
  O->>O: check the brief
  opt the brief has one real trade-off
    O->>Owner: question card with options
    Owner-->>O: picks an option
  end
  O->>D: station 2, Database (gets the brief)
  D-->>O: tables and seed data
  O->>DB: CREATE TABLE, insert seed rows
  O->>O: checks (links, seed rows, tables really created)
  Note over O,D: an added step such as Normalise tables runs here.<br/>It only proposes changes, and each one is checked first.
  O->>B: station 3, Backend (gets brief and tables)
  B-->>O: workflow, endpoints, access rules
  O->>O: checks, call every endpoint as every role
  Note over O,B: if a check fails the work goes back to the same agent<br/>with the failed checks as feedback, up to three attempts.<br/>After the last try, a safe default or a failed build.
  B-->>O: second attempt after a send-back
  O->>Owner: approval card (the owner asked to stop after Backend)
  Owner-->>O: approve (or stop here)
  O->>V: station 4, Views
  V-->>O: views per table, dashboard
  O->>O: checks, mount every view with real data
  O->>U: station 5, Screens
  U-->>O: screens, theme, tour
  O->>O: checks, mount every screen for every role
  O->>U: station 6, Walkthrough
  Note over U,O: code plays the tour as an acceptance test<br/>against the real endpoints
  U-->>O: tour (already written at station 5)
  O->>O: run the tour
  O->>T: Tests, the app is built but not yet ready
  T-->>O: test cases written from the brief's rules and stories
  loop at most three runs
    O->>DB: play every test inside a savepoint, then roll back
    alt a test fails
      O->>T: report the failures
      T->>B: send back for repair
      B-->>O: proposed fix
      O->>O: apply the fix as a checked change (same checks as a chat change)
    end
  end
  O->>Owner: app is ready, or says which tests still fail
```

What each step really does, with where to read it:

| Step                                   | What happens                                                                                                                                                                                                                              | Code                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Agents answer in JSON                  | Each agent returns one JSON object. Code validates and normalises it. Nothing a model writes is run as code.                                                                                                                              | `line.ts` (`PROMPTS`, `APPLY`)         |
| Check after each station               | `APPLY[station]` returns a list of checks. Examples: the tables were created in SQLite, every endpoint was called as every role, every view and screen drew with real data, the tour passes against the endpoints.                        | `line.ts`, `engine.tsx`, `runtime.tsx` |
| Send-back                              | A failed check puts the station in "sent back", posts a card in chat, and runs the agent again with the failed checks in its prompt. At most three attempts (the owner can lower it).                                                     | `line.ts`, `runStation`                |
| Safe default                           | After the last attempt, Backend, Views, Screens and Walkthrough fall back to rule-built output that must also pass its checks. Research and Database have no default; if they fail, the build stops and says why.                         | `line.ts`, `FALLBACK`                  |
| Approval                               | The owner can ask for a stop after any station. The line waits on an approval card (or the chat words "approve" or "stop").                                                                                                               | `custom.tsx`, `askGate`                |
| The owner's own steps                  | Four review agents (Data, Security, Insight, Wording), two that apply their own changes (Normaliser, UI stylist), and up to eight added steps in all. Reviewers never stop the line.                                                      | `custom.tsx`, `REVIEWERS`, `runReview` |
| Tester and repair                      | The Tester writes test cases as data. Code plays them in a savepoint. Failures go to the Backend agent for a repair, which is applied only if it passes the checks. At most three runs. A version can only be released if all tests pass. | `tester.tsx`, `runTester`              |
| If a run that keeps the database fails | The app goes back exactly as it was.                                                                                                                                                                                                      | `line.ts`, `runBuild`                  |

Demo and Live use the same line. In Demo each agent's answer is replayed from a saved build and no model is called. In
Live each agent's turn runs on the server step graph (section 4). The run header shows "N model calls" or "N replayed, 0 model calls".

## 4. One agent step

What one station does for one agent in Live. The browser builds the prompt and owns the checks that need the app's
database; the server runs the model and checks the shape of the answer against the role's schema before it comes back.

```mermaid
sequenceDiagram
  autonumber
  participant L as Station (browser, line.ts)
  participant MC as Model client (AG-UI)
  participant CK as /api/copilotkit, agent step
  participant G as Step graph (server)
  participant M as Claude model
  L->>MC: prompt for this agent, failed checks from the last try
  MC->>CK: RunAgentInput (prompt, role, tier)
  CK->>CK: guard rails: prompt policy, limits, caps
  CK->>G: run
  G->>G: guard: input and provider
  loop at most 3 model calls
    G->>M: draft
    M-->>G: text (streamed to the browser as TEXT_MESSAGE events)
    G->>G: validate: find the JSON, check it against the role's schema
    opt the shape is wrong
      G->>G: repair: add the exact failures to the conversation
    end
  end
  G-->>MC: STEP events for draft, validate, repair, then the result
  MC-->>L: JSON text
  L->>L: apply it to the app (CREATE TABLE, call endpoints as every role, draw views)
  alt all checks pass
    L->>L: station ok, hand-off to the next station
  else checks fail and attempts are left
    L->>MC: send back with the failures (a new step)
  else no attempts left
    L->>L: safe default if it passes, or the build stops and says why
  end
```

So an answer is checked twice: once on the server for its shape (`src/server/graph/step/graph.ts`, schemas in
`src/server/agents/schemas.ts`), once in the browser for what it does to the real app (`APPLY` in `line.ts`). Each
model call on the server goes through the gateway, which sets the effort for the tier (Sonnet at medium for building
roles, Haiku at low for quick ones), marks the stable prompt for caching and logs tokens and cost.

Every step is an AG-UI event (`RUN_STARTED`, `STEP_STARTED`, `TEXT_MESSAGE_*`, `STATE_DELTA`, `STEP_FINISHED`,
`RUN_FINISHED`, and `CUSTOM` for `checks`, `sent_back`, `interrupt`, `resume`). The canvas, the timeline, the log, the
Agents panel (`src/workspace/activity.tsx`) and debug mode all read them. Details: [`ag-ui.md`](ag-ui.md).

## 5. A team run: the fact-check app

The apps Turnkey builds can have agents of their own. The Fact-check desk has three: Extractor, Researchers and
Verifier (`src/workspace/quests.ts`). The Backend agent writes the team as data. In Live the server compiles it into a
LangGraph graph (`src/server/graph/team`) and streams AG-UI events back; the browser owns the app's database, so each
accepted answer is written there through the app's own API as the person who pressed Run, and the access rules apply
to the agents too (`src/workspace/team.tsx`).

```mermaid
sequenceDiagram
  autonumber
  actor Editor
  participant Room as Check room (browser)
  participant TR as /api/agent/team
  participant X as Extractor
  participant S as Researchers
  participant Src as Wikipedia / World Bank
  participant C as Check (rules, then a reviewer model)
  participant V as Verifier
  participant API as App API and SQLite (browser)

  Editor->>Room: pastes text, presses Run
  Room->>API: start_check (workflow action, role-checked)
  Room->>TR: the team, the text, the tables its answers must fit
  TR->>X: split the text into factual claims
  X-->>TR: claims
  TR->>C: check the claims
  C-->>TR: ok (or send back once, with the reason)
  TR-->>Room: claims (AG-UI events)
  Room->>API: write claims, as the Editor
  TR->>S: find evidence for each claim
  S->>TR: lookup request (page_summary, get_indicator)
  TR->>Src: connector call, validated and time-limited
  Src-->>TR: public data
  TR->>S: the lookup result
  S-->>TR: evidence with a stance and a link
  TR->>C: check the evidence
  TR-->>Room: evidence
  Room->>API: write evidence, as the Editor
  TR->>V: weigh the evidence
  V-->>TR: verdict and confidence per claim, summary
  TR-->>Room: verdicts, RUN_FINISHED
  Room->>API: update claims, finish_check
  Note over Room,API: a write the access rules refuse is reported as a failed step
```

The same graph runs the other teams:

| App                | Agents, in order                         | Pause for a person                               | Tools                        |
| ------------------ | ---------------------------------------- | ------------------------------------------------ | ---------------------------- |
| Fact-check desk    | Extractor, Researchers, Verifier         | none                                             | Wikipedia, World Bank        |
| Prior-art scout    | Search, Analyst, Critic                  | none                                             | PatentsView, OpenAlex, arXiv |
| Debate partner     | For, Against, Moderator                  | before the Moderator: add a point from the floor | none                         |
| Sales bidding desk | Qualifier, Pricing, Red team             | before the Red team: add a risk or a condition   | none                         |
| Grant review desk  | Assessor, Budget reviewer, Due diligence | before Due diligence: add a condition            | none                         |

Each agent answers one JSON object and may write only what the team definition lets it. A pause ends the request with
a snapshot; the person's note and the snapshot start a second request that resumes the run. Caps are part of the
graph's state (model calls, tool calls, one send-back per agent), and every run passes through a `finish` node, whether
it completed or hit a cap. In Demo the run replays a saved script and its lookups are recorded samples.

## 6. A change from chat

The owner types a change into the chat sidebar. Only the stations the change touches run again (`src/workspace/changes.ts`,
`handleChat`, `runChange`, `applyChangeSync`).

```mermaid
sequenceDiagram
  autonumber
  actor Owner
  participant O as Orchestrator
  participant M as Model (Live) or built-in reader (Demo)
  participant DB as SQLite (savepoint)
  participant S as Station checks

  Owner->>O: "Add a notes field to score lines"
  O->>M: translate the message into operations
  M-->>O: operations (add field, rename, change access, add view...)
  O->>Owner: plan card: the steps, the SQL, which stations re-run
  opt a step deletes data
    O->>Owner: approval card (Keep the data / Approve)
    Owner-->>O: decision
  end
  O->>DB: open a savepoint, apply every step
  loop from the first touched station to the last
    O->>S: re-check the station (tables, rules, views, screens, tour)
    S-->>O: pass or fail
  end
  alt every check passes
    O->>DB: release the savepoint
    O->>O: regenerate the tests, log the change
    O->>Owner: done, lists what re-ran and what was skipped
  else a check fails
    O->>DB: roll back to the savepoint
    O->>Owner: not applied, the app is exactly as it was
  end
```

The Tester's repair (section 3) goes through the same path: a repair is a change request that has to pass the same
checks.

## 7. Deployment pipeline

Merging does not deploy. Vercel's Git integration is off (`vercel.json`), and production is deployed only by a release
(`.github/workflows/release.yml`). CI runs only on a pull request that is out of draft and labelled `ready-to-merge`,
to save Actions minutes while many agents push at once. Details: [`docs/process/deploy.md`](../process/deploy.md).

```mermaid
flowchart LR
  br["Branch<br/>feat/, fix/, docs/..."] --> pr["Draft pull request<br/>names its issue"]
  pr --> lbl["Out of draft,<br/>label ready-to-merge"]
  lbl --> ci
  subgraph ci["CI: .github/workflows/ci.yml"]
    direction TB
    chk["check: secrets scan, lint,<br/>typecheck, unit tests, build"] --> e2e["e2e: 12 browser flows in parallel<br/>demo, live, misc, views, quests, new,<br/>custom, round6, react, sizes, offline, a11y"]
  end
  ci --> gate{"CI green?"}
  gate -->|"no"| pr
  gate -->|"yes"| merge["Squash merge to main<br/>(nothing deploys)"]
  merge --> bump["Pull request that raises<br/>the version in package.json"]
  bump --> rel["release.yml: tag, GitHub release,<br/>Vercel CLI deploy to production"]
  rel --> live["Live URL<br/>/api/health shows<br/>the deployed commit"]
  live --> smoke["smoke job: scripts/smoke-live.mjs<br/>page, version, a short link"]
```

Secrets: the model key lives only in Vercel's environment variables (and `.env.local` locally,
which git ignores). `npm run check:secrets` runs in CI. Nothing starts with `NEXT_PUBLIC_`.

## 8. The agents at a glance

Which agents exist, what they write, and who checks them.

```mermaid
flowchart LR
  subgraph build["Build line (the owner watches on the Build tab)"]
    direction LR
    r["Researcher<br/>brief"] --> d["Database<br/>tables, seed data"] --> b["Backend<br/>workflow, endpoints, access"] --> v["View advisor<br/>views, dashboard"] --> u["UI<br/>screens, tour"] --> t["Tester<br/>test cases, repair requests"]
    t -.->|"failed test: repair request"| b
  end
  orch["Orchestrator (code)<br/>checks every handoff,<br/>sends work back, asks the owner"]
  orch -.- build
  subgraph extra["Added by the owner, optional"]
    rv["Data, Security, Insight, Wording reviewers<br/>Normaliser, UI stylist, own agents"]
  end
  build --- extra
  subgraph team["Inside a built app: its own agent team"]
    direction LR
    a1["Agent 1<br/>for example Extractor"] --> a2["Agent 2<br/>Researchers"] --> a3["Agent 3<br/>Verifier"]
  end
  build ==>|"builds"| team
```

## 9. The workflow as a graph

The workflow the owner edits on the canvas compiles into a LangGraph graph that runs in the browser
(`@langchain/langgraph/web`, `src/platform/orchestrator`, `compileWorkflow` and `createRun`), and every build runs
through it. Approvals and the Researcher's question are LangGraph interrupts; the owner's answer resumes the run.
When the owner edits the workflow of a built app, only the stations the edit touches run again, after a short pause
that gathers a burst of edits into one run; a re-run that would rebuild the database asks first
(`src/workspace/rerun.tsx`). Below is the shape for one station. Every station repeats it; Research adds the question
to the owner, and stations that have a safe default add a fallback node.

```mermaid
flowchart TD
  start([start]) --> st["station: the agent answers<br/>(model call or replay)"]
  st --> gate{"gate: code checks the answer"}
  gate -->|"pass"| done["done: card, STATE_DELTA"]
  gate -->|"fail, attempts left"| sb["send back with the failures"] --> st
  gate -->|"fail, last attempt"| fbk{"safe default<br/>exists and passes?"}
  fbk -->|"yes"| done
  fbk -->|"no"| fail(["fail: the run stops and says why"])
  done --> steps["added steps after this station<br/>(reviewers, the owner's agents)"]
  steps --> appr{"owner asked for<br/>approval here?"}
  appr -->|"yes"| wait["interrupt: wait for the owner"] --> next
  appr -->|"no"| next["handoff to the next station"]
  next -.-> tests["after the last station:<br/>tests_write, tests_run, tests_repair (at most 3 runs)"]
  tests -.-> fin([ready])
```

The full generated graph for the default workflow, with every node, is in
[`src/platform/orchestrator/default-workflow.mmd`](../../src/platform/orchestrator/default-workflow.mmd)
(`node src/platform/orchestrator/scripts/print-mermaid.mjs` prints it again).

## 10. Guard rails on every model call

The app is public, has no login, and the model budget is small. Every route that can spend it passes the same checks
first (`src/server/guard`), and the workspace adds its own per-session cap.

```mermaid
flowchart LR
  req["Request from the browser<br/>/api/copilotkit, /api/agent/team,<br/>/api/agent/step, /api/llm"] --> site{"same site?"}
  site -->|"no"| r1["refused"]
  site -->|"yes"| body{"body size and<br/>shape valid?"}
  body -->|"no"| r2["bad_request"]
  body -->|"yes"| pol{"prompt policy: one of Turnkey's<br/>own agent prompts? (team runs:<br/>no injected instructions)"}
  pol -->|"no"| r3["refused: not a free chat"]
  pol -->|"yes"| lim{"per-visitor and global rate,<br/>daily calls, daily dollars,<br/>LIVE_MODE"}
  lim -->|"over"| r4["rate_limited or budget:<br/>Live says so in plain words"]
  lim -->|"ok"| gw["model gateway<br/>logs tokens and cost"]
```

Defaults: 20 calls per visitor and 50 for everyone per minute, 600 calls and 5 dollars a day, prompts up to 120,000
characters, answers up to 8,000 tokens (`src/server/guard/limits.ts`). The workspace stops a Live session after 40
model calls (`CAP` in `src/workspace/core.ts`). Counters live in each server instance's memory, so they are a brake;
the provider's own budget is the hard stop.
