# Architecture overview

This page shows how Turnkey is put together and how its agents work with each other. Every diagram is written in
Mermaid, so GitHub draws it from the text in this file.

**Status words used below.** _Built_ means it is in `main` and covered by the browser checks. _Planned_ means another
work package is building it and it is not merged yet; the work package number (WP-nn) points to its issue. When one
merges, this page is updated in a follow-up pull request. In the diagrams, planned parts have a dashed outline.

Two facts to keep in mind while reading:

- The agents' orchestration (stations, checks, send-backs, approvals, the Tester, app agent teams, changes from chat)
  is built, and runs in the browser from `src/legacy`. The server today holds the model route, the guard rails and
  the health route. The server-side graphs are planned (WP-05, WP-06, WP-08, WP-16).
- Code, not a model, decides whether an agent's answer is good enough. The Orchestrator is code.

Contents: [1 System context](#1-system-context) · [2 Containers](#2-containers) ·
[3 The build workflow](#3-the-build-workflow) · [4 One agent step](#4-one-agent-step) ·
[5 A team run: the fact-check app](#5-a-team-run-the-fact-check-app) · [6 A change from chat](#6-a-change-from-chat) ·
[7 Deployment pipeline](#7-deployment-pipeline) · [8 The agents at a glance](#8-the-agents-at-a-glance)

## 1. System context

Who uses Turnkey and what it talks to.

```mermaid
flowchart LR
  owner["Owner<br/>describes an app, watches the agents,<br/>approves, asks for changes"]
  user["App user<br/>opens a built app by share link"]
  subgraph turnkey["Turnkey (one Next.js project on Vercel)"]
    ws["Workspace in the browser<br/>and its server routes"]
  end
  gw["LiteLLM gateway<br/>Claude models, key kept on the server"]
  pub["Public sources<br/>Wikipedia, World Bank, OpenAlex,<br/>arXiv, PatentsView"]
  gh["GitHub<br/>repository and CI"]
  vc["Vercel<br/>builds and hosts"]
  owner --> ws
  user --> ws
  ws -->|"one agent step per request"| gw
  ws -.->|"planned, WP-07"| pub
  gh -->|"merge to main"| vc
  vc -->|"deploys"| turnkey
  classDef planned stroke-dasharray: 5 5
  class pub planned
```

Notes:

- With no model configured, saved builds and every screen still work (Demo mode). Live mode needs the gateway.
- The public-source connectors are planned (WP-07). Today, the three quest apps show saved sample evidence in Demo,
  and in Live their agents work from what the model knows. The app says so on its About page ("What is real in this
  prototype", `src/legacy/shell-c.js`).

## 2. Containers

What runs where. The browser holds the product and its data. The server is stateless: it relays model calls and
enforces limits.

```mermaid
flowchart TB
  subgraph browser["Browser"]
    direction TB
    legacy["Workspace<br/>src/legacy: workflow canvas, six agents,<br/>checks, Tester, teams, rooms, 8 data views"]
    compat["Compatibility layer<br/>src/platform/compat: React 19 behind<br/>the names the modules already use"]
    mc["Model client<br/>src/platform/model-client.ts"]
    sqlite[("SQLite (sql.js, WebAssembly)<br/>one database per app")]
    store[("Browser storage<br/>app definitions, settings, releases")]
    legacy --> compat
    legacy --> sqlite
    legacy --> store
    legacy --> mc
  end
  subgraph server["Server: Next.js route handlers on Vercel (stateless)"]
    direction TB
    llm["POST /api/llm<br/>one guarded model call, streamed"]
    health["GET /api/health<br/>up, model configured, probes"]
    ck["/api/copilotkit<br/>CopilotKit runtime; the spike's agent today"]
    guard["Guard rails<br/>src/server/guard: rate limits,<br/>daily cap, prompt size, LIVE_MODE switch"]
    gateway["Model gateway<br/>src/server/llm: LiteLLM / OpenAI-compatible,<br/>mock provider"]
    llm --> guard --> gateway
    ck --> gateway
    health --> gateway
    graphs["LangGraph agent graphs<br/>agent step, app team (planned, WP-05, WP-06)"]
    agui["AG-UI agent registry<br/>(planned, WP-08)"]
    conn["Connectors to public sources<br/>(planned, WP-07)"]
    ck -.-> agui -.-> graphs
    graphs -.-> conn
    graphs -.-> gateway
  end
  ext["LiteLLM gateway"]
  mc -->|"newline-delimited JSON"| llm
  gateway --> ext
  classDef planned stroke-dasharray: 5 5
  class graphs,agui,conn planned
```

Rules the layout enforces (also in `CLAUDE.md`): the browser never calls a model provider; nothing in `src/server` is
imported from `src/platform` or `src/legacy`; keys are read only in server code.

Also planned: a storage adapter with IndexedDB (WP-10), an installable app with offline support (WP-11), and the build
workflow compiled to a graph behind a switch (WP-09, wired by WP-16). Until then the classic orchestrator in
`src/legacy/line.js` is the only one.

## 3. The build workflow

One build, from one sentence to a working app. There are five builder agents (Researcher, Database, Backend, View
advisor, UI) and the Tester, which makes six agents with distinct jobs. The Orchestrator is code that runs the
stations in order and checks each handoff (`src/legacy/line.js`, `runBuild` and `runStation`).

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

| Step                                   | What happens                                                                                                                                                                                                                              | Code                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Agents answer in JSON                  | Each agent returns one JSON object. Code validates and normalises it. Nothing a model writes is run as code.                                                                                                                              | `line.js` (`PROMPTS`, `APPLY`)        |
| Check after each station               | `APPLY[station]` returns a list of checks. Examples: the tables were created in SQLite, every endpoint was called as every role, every view and screen drew with real data, the tour passes against the endpoints.                        | `line.js`, `engine.js`, `runtime.js`  |
| Send-back                              | A failed check puts the station in "sent back", posts a card in chat, and runs the agent again with the failed checks in its prompt. At most three attempts (the owner can lower it).                                                     | `line.js`, `runStation`               |
| Safe default                           | After the last attempt, Backend, Views, Screens and Walkthrough fall back to rule-built output that must also pass its checks. Research and Database have no default; if they fail, the build stops and says why.                         | `line.js`, `FALLBACK`                 |
| Approval                               | The owner can ask for a stop after any station. The line waits on an approval card (or the chat words "approve" or "stop").                                                                                                               | `custom.js`, `askGate`                |
| The owner's own steps                  | Four review agents (Data, Security, Insight, Wording), two that apply their own changes (Normaliser, UI stylist), and up to eight added steps in all. Reviewers never stop the line.                                                      | `custom.js`, `REVIEWERS`, `runReview` |
| Tester and repair                      | The Tester writes test cases as data. Code plays them in a savepoint. Failures go to the Backend agent for a repair, which is applied only if it passes the checks. At most three runs. A version can only be released if all tests pass. | `tester.js`, `runTester`              |
| If a run that keeps the database fails | The app goes back exactly as it was.                                                                                                                                                                                                      | `line.js`, `runBuild`                 |

Demo and Live use the same line. In Demo each agent's answer is replayed from a saved build and no model is called. In
Live each agent makes its own model call. The run header shows "N model calls" or "N replayed, 0 model calls".

## 4. One agent step

What one station does for one agent. Today this runs in the browser; the server version as a small LangGraph graph is
planned (WP-05) and is drawn as the dashed part.

```mermaid
flowchart TD
  start(["Station starts<br/>STEP_STARTED"]) --> mode{"Demo or Live?"}
  mode -->|"Demo"| replay["Replay the saved answer<br/>for this attempt"]
  mode -->|"Live"| prompt["Build the prompt:<br/>the task, the earlier agents' output,<br/>the owner's standing instruction,<br/>failed checks from the last try"]
  prompt --> mcall["One model call<br/>POST /api/llm, streamed"]
  mcall --> parse{"Valid JSON?"}
  parse -->|"no"| fb["Feedback: answer was not usable"]
  parse -->|"yes"| apply["Normalise and apply the output<br/>(for example CREATE TABLE)"]
  replay --> apply
  apply --> checks{"All checks pass?"}
  checks -->|"yes"| done["Station ok: facts, card in chat,<br/>STATE_DELTA, STEP_FINISHED,<br/>handoff to the next station"]
  checks -->|"no"| tries{"Attempts left?<br/>(at most 3)"}
  fb --> tries
  tries -->|"yes"| sent["Sent back: card in chat shows<br/>the failed checks"]
  sent --> prompt
  tries -->|"no"| safe{"Safe default<br/>exists and passes?"}
  safe -->|"yes"| done
  safe -->|"no"| fail["Station failed:<br/>the build stops and says why"]
  subgraph planned_graph["Planned: the same loop as a server graph, WP-05"]
    g1["draft"] --> g2["validate against a schema"] --> g3["repair"] --> g2
  end
  classDef planned stroke-dasharray: 5 5
  class g1,g2,g3 planned
  style planned_graph stroke-dasharray: 5 5
```

Each step emits AG-UI style events (`RUN_STARTED`, `STEP_STARTED`, `TEXT_MESSAGE_*`, `STATE_DELTA`, `STEP_FINISHED`,
`RUN_FINISHED`, and `CUSTOM` for `checks`, `sent_back`, `interrupt`, `resume`). Today they feed the workspace's own
event log and the Debug drawer (Settings, Debug mode). Sending them from the server through the CopilotKit runtime is
planned (WP-08, WP-16).

## 5. A team run: the fact-check app

The apps Turnkey builds can have agents of their own. The Fact-check desk has three: Extractor, Researchers and
Verifier (`src/legacy/quests.js`, `src/legacy/team.js`). The Backend agent writes the team as data. A fixed engine
runs it. Every write goes through the app's own API as the person who pressed Run, so the access rules apply to the
agents too.

```mermaid
sequenceDiagram
  autonumber
  actor Editor
  participant Room as Check room (screen)
  participant E as Engine (code)
  participant X as Extractor
  participant S as Researchers
  participant Src as Wikipedia / World Bank
  participant V as Verifier
  participant API as App API and SQLite
  actor Senior as Senior editor

  Editor->>Room: pastes text, presses Run
  Room->>E: runTeam(check)
  E->>API: start_check (workflow action, role-checked)
  E->>X: split the text into factual claims
  X-->>E: claims
  E->>API: write claims, one row at a time, as the Editor
  E->>S: find evidence for each claim
  S->>Src: page_summary / get_indicator
  Src-->>S: sample response today, public data once WP-07 merges
  S-->>E: evidence rows with a stance and a link
  E->>API: write evidence, as the Editor
  E->>V: weigh the evidence
  V-->>E: verdict and confidence per claim, summary of the text
  E->>API: update claims, fill the check's summary and accuracy
  Note over E,API: a write the access rules refuse is reported as a failed step
  E->>API: finish_check (workflow action)
  Room-->>Editor: claims, evidence, verdicts fill in live
  Senior->>API: reviews and corrects verdicts, publishes the check
```

The same engine runs the other apps:

| App                | Agents, in order                 | Pause for a person                               | Tools                        |
| ------------------ | -------------------------------- | ------------------------------------------------ | ---------------------------- |
| Fact-check desk    | Extractor, Researchers, Verifier | none                                             | Wikipedia, World Bank        |
| Prior-art scout    | Search, Analyst, Critic          | none                                             | PatentsView, OpenAlex, arXiv |
| Debate partner     | For, Against, Moderator          | before the Moderator: add a point from the floor | none                         |
| Sales bidding desk | Qualifier, Pricing, Red team     | before the Red team: add a risk or a condition   | none                         |

Each agent answers one JSON object. Each is limited to what the team definition lets it write. A run can be stopped. In
Demo the run replays a saved script, and the tool calls are recorded samples; in Live every agent makes its own model
call (`teamLive`, one retry if the answer is not usable).

The planned server version (WP-06) compiles the same team definition to a LangGraph graph with a checking agent that
can send work back once.

## 6. A change from chat

The owner types a change into the chat sidebar. Only the stations the change touches run again (`src/legacy/changes.js`,
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

Only `main` deploys. Other branches do not (`vercel.json`), because the free plan allows a limited number of
deployments a day and several agents push at once.

```mermaid
flowchart LR
  br["Branch<br/>feat/, fix/, docs/..."] --> pr["Pull request<br/>names its issue"]
  pr --> ci
  subgraph ci["CI: .github/workflows/ci.yml"]
    direction TB
    chk["check: secrets scan, lint,<br/>typecheck, unit tests, build"] --> e2e["e2e: 8 flows in parallel<br/>demo, live, misc, views,<br/>quests, new, custom, round6<br/>(286 browser checks)"]
  end
  ci --> gate{"CI green?"}
  gate -->|"no"| pr
  gate -->|"yes"| merge["Squash merge to main<br/>(by the supervisor)"]
  merge --> vercel["Vercel Git integration<br/>builds and deploys main"]
  vercel --> live["Live URL<br/>/api/health shows<br/>the deployed commit"]
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
