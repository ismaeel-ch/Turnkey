# Hackathon rules and scoring: where this entry stands

Source: the Agent-A-Thon 2026 kickoff deck (26 Nov 2026) and the portal's rules and guide pages. The docs-architect
agent keeps this page current; the compliance-auditor checks it after each milestone.

## Dates

- Build window opens: Fri 27 Nov 2026, 12:00 AM PKT
- Submissions close: **Mon 30 Nov 2026, 2:00 PM PKT** (the latest submitted version is the one evaluated)
- Submit: GitHub repo URL, live production URL, summary of up to 600 characters

## How to read this page

- **Live app** is https://ssi-ai-hackathon.vercel.app/. Nothing needs a login. The title bar has a **Live** switch; with
  it off (Demo) every build replays a saved run and no model is called, so an evaluator can see every screen without
  spending budget.
- **Built** means in `main` and covered by the browser checks (`tests/e2e/flows.cjs`; 286 checks in 8 flows). **Planned** means another work package is building it and it is not merged yet;
  the table says which. This page is updated in a follow-up pull request when those merge.
- Where an evaluator looks: the app's top-level tabs are **Build**, **App**, **Release** and **Details**. Under Build
  the switch **Workflow / Timeline / Log** shows the same run three ways. **Debug mode** (Settings, or the bug icon in
  the title bar) opens the event, tool-call, model-usage, SQL and API-call tabs. The orchestration diagrams are in
  [`docs/architecture/overview.md`](../architecture/overview.md).

## Step 1: the filter (pass every check or the entry is out)

| Check                                   | Evidence in this repository                                                                                                                                                                                                                                  | Where to see it in the live app                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Your own individual work                | One author, one repository: `github.com/ismaeel-ch/Turnkey`. Commit history on `main`. Code written with Claude Code, which the rules allow (Level 4 of the deck).                                                                                           | The repository's contributors and commits.                                                                                               |
| No client or internal data              | Every agent invents its seed data and the quest apps' samples are marked as samples (`SAMPLE_NOTE`, `sampleNote` in `src/legacy/builds.js`, `quests.js`). `CLAUDE.md` rule 3 forbids real data, including in tests.                                          | Open any saved build and its Data tab (Details, Data): made-up names and figures. About dialog, "What is real in this prototype".        |
| No API key in the code                  | Keys are read only in `src/server/llm` (`resolveProvider`). `scripts/check-secrets.mjs` runs in CI (`npm run check:secrets`). `.env.example` holds names only. `.gitignore` covers `.env*.local`. No `NEXT_PUBLIC_` names.                                   | `/api/health` answers whether a model is configured and never returns a key. Browser network tab: no key in any request.                 |
| Live on a public URL                    | One Next.js project deployed by Vercel from `main` (`vercel.json`). No account needed to open it.                                                                                                                                                            | https://ssi-ai-hackathon.vercel.app/ and `/api/health` (shows the deployed commit).                                                      |
| Safe AI-agent settings                  | `.claude/settings.json` sets `defaultMode: acceptEdits`, not full auto, and denies reading env files and pushing to `main`. Hooks in `.claude/hooks` (`guard-bash.mjs`, `guard-files.mjs`) enforce it.                                                       | Not visible in the app; read the file.                                                                                                   |
| Agentic, not a single prompt            | Five builder agents plus the Tester, each with its own prompt, schema checks and handoff (`src/legacy/line.js`, `tester.js`), and agent teams inside built apps (`team.js`). Diagrams: sections 3 to 5 of the overview.                                      | Build tab, Workflow: nodes for every agent, check gates between them. Timeline: who worked when. Log: every step in order.               |
| Works end to end                        | Sentence to a working app with database, endpoints, views, screens and tests, then released and shared. 286 browser checks in 8 flows run in CI on every pull request.                                                                                       | Pick a saved build (for example "Sales bidding desk"), watch it finish, open the **App** tab and use it. Then **Release** and **Share**. |
| App stays up, no crashes                | Stateless server; `/api/llm` is guarded by `src/server/guard/limits.ts` (per-visitor and global rate, daily call cap, prompt size, output size, `LIVE_MODE=off` switch). Demo needs no model. A missing variable never crashes the app (`CLAUDE.md` rule 6). | `/api/health`. Turn Live off: everything still works. With no model configured, Live says so plainly.                                    |
| Public GitHub repo that matches the app | The repository is public. Vercel deploys `main`; the deployed commit is shown by `/api/health`, so it can be compared with the repository's latest commit.                                                                                                   | `/api/health` against `git log -1` on `main`.                                                                                            |

Level 1 rules that are not part of the filter:

| Rule                                    | Evidence                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model access through LiteLLM            | `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL` are the primary provider names (`src/server/llm/index.ts`, `.env.example`). The spike (`/spike`) calls tools through it. |
| Budget (25 dollars) also covers judging | Guard limits above; Demo mode needs no model; the Quick setting uses a cheaper model tier; one agent step per request keeps each call small.                                    |
| Each agent's steps shown in the app     | Workflow, Timeline and Log views; per-agent inspector with Output and Checks; chat cards for every handoff; Debug drawer with the AG-UI style events and token estimates.       |

## Step 2: the five criteria (1 to 10 each, equal weight)

### 1. Completeness, including multi-agent orchestration

What judges look for: works end to end; agents with distinct roles that hand work to each other and check each other;
each agent's steps shown.

| Evidence                                                                                                                                                                                                                                    | Where                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Distinct roles: Researcher, Database, Backend, View advisor, UI, Tester. The Orchestrator is code that runs them in order.                                                                                                                  | `src/legacy/line.js` (`AGENTS`, `STATIONS`), `tester.js`. Build tab, Workflow.                                                                                                                         |
| Handoffs: each agent receives the validated output of the ones before it (the brief, then the tables, then the rules, and so on).                                                                                                           | Sequence diagram, overview section 3. Build tab: arrows between nodes; the chat shows each handoff.                                                                                                    |
| Agents check each other: code checks after every station; a failed check sends the work back to the same agent with the failures in its prompt, at most three tries; the Tester's cases fail the Backend's work and the Backend repairs it. | `line.js` (`runStation`), `tester.js` (`runTester`). Open "Sales bidding desk": its Backend answer keeps one planted slip so the repair is visible in Demo (`REC.biddesk.slip`). Build tab, **Tests**. |
| Human in the loop: a question card from the Researcher, approval gates the owner places after any station, approval before a change that deletes data, and a pause in the debate and bidding teams.                                         | `custom.js` (`askGate`), `changes.js` (`askApproval`), `team.js` (`teamWait`). Build tab, **Customize**.                                                                                               |
| The owner can change the workflow: add review agents and the owner's own agents, give a station to built-in rules, set the number of attempts. The canvas shows it.                                                                         | `custom.js`. Build tab, Workflow, **Customize**.                                                                                                                                                       |
| Apps Turnkey builds have their own agent teams: Fact-check (3 agents), Prior-art scout (3), Debate partner (3), Sales bidding desk (3).                                                                                                     | `src/legacy/quests.js`, `builds.js`, `team.js`, `room.js`. In a built app, the Check room, Scout room, Debate room or Bid room screen.                                                                 |
| Whole life cycle: build, use, change from chat, release a numbered version (tests must pass), share by link.                                                                                                                                | Release tab, Share button. `src/legacy/release.js`, `share.js`.                                                                                                                                        |
| 286 browser checks in 8 flows, run on every pull request.                                                                                                                                                                                   | `tests/e2e/flows.cjs`; CI job `e2e` in `.github/workflows/ci.yml`.                                                                                                                                     |
| Planned, not merged: the same orchestration as server graphs (agent step, app team: WP-05, WP-06), an AG-UI agent registry (WP-08), the workflow as a graph (WP-09), wiring (WP-16).                                                        | Tracked in `docs/PLAN.md` section 4 and the issues.                                                                                                                                                    |

### 2. Technical execution

| Evidence                                                                                                                                                                         | Where                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Clean build in CI on every pull request: secrets scan, lint, typecheck, unit tests, production build, then the browser flows. Next.js 16 and React 19.                           | `.github/workflows/ci.yml`; `npm run check`.                                              |
| Key kept out of the code: read only in server code, scanned in CI, a rule in `CLAUDE.md`, a hook that blocks reading env files.                                                  | `scripts/check-secrets.mjs`, `src/server/llm/index.ts`, `.claude/hooks`.                  |
| The browser never calls a model provider. Calls go to `POST /api/llm`, which validates the request, applies limits and streams the answer.                                       | `src/app/api/llm/route.ts`, `src/server/guard/limits.ts`, `src/platform/model-client.ts`. |
| Agents return JSON that code validates. Nothing a model writes is run as code, and a share link is treated as untrusted input.                                                   | `line.js` (`normBrief`, `normSchema` and the other normalisers), `share.js`. ADR 5.       |
| Real database in the page: SQLite compiled to WebAssembly, tables created from the agents' definitions, changes as migrations inside savepoints that roll back if a check fails. | `src/legacy/db.js`, `changes.js` (`applyChangeSync`); Details, Data.                      |
| Role-guarded endpoints derived from the definitions, called by the UI, the checks and the app agents alike.                                                                      | `runtime.js`, `engine.js`; Details, API.                                                  |
| Every model loop is capped (three attempts, three test runs, one retry for a team agent), and the model route is rate-limited and capped per day.                                | `line.js`, `tester.js`, `team.js`, `limits.ts`.                                           |
| Decisions written down with reasons.                                                                                                                                             | [`docs/adr/`](../adr/)                                                                    |
| Planned, not merged: LangGraph graphs on the server (WP-05, WP-06), AG-UI registry (WP-08), storage adapter (WP-10), provider additions (WP-03), stronger prompt policy (WP-04). | `docs/PLAN.md` section 4.                                                                 |

### 3. Creativity and uniqueness

| Evidence                                                                                                                                                                                           | Where                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The product is the tool that builds agent apps, not one agent app. The three suggested quests and a bidding desk are built by it and come out as separate working apps with their own agent teams. | Home screen: the saved builds. `quests.js`, `builds.js`.    |
| The workflow is the canvas: the owner edits the line the agents run on (add a step, add an approval, hand a station to rules), and only the affected stations run again.                           | Build tab, Workflow, **Customize**; `custom.js`, `flow.js`. |
| The Tester writes test cases from the brief and a failure goes back to the agent that owns the failing part for a checked repair, so the app is "ready" only after its tests pass.                 | Build tab, Tests. `tester.js`.                              |
| Changes from chat re-run only the stations they touch and roll back on any failed check.                                                                                                           | Chat sidebar, "Try a change". `changes.js`.                 |
| Each built app gets a room where its agents' work appears row by row, in a layout chosen from a fixed catalog (versus, list, groups, scores, options).                                             | The room screen of a quest app. `room.js`, `viewspec.js`.   |
| Each app gets its own icon, designed by the UI agent as data.                                                                                                                                      | Release tab. `release.js`.                                  |

### 4. Business value

| Evidence                                                                                                                                                                            | Where                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A team that needs a small internal tool (a register, a tracker, an approval flow) gets one in minutes with roles, access rules and tests, instead of waiting for a developer.       | Saved builds: clinic, help desk, leave requests, sales bidding desk. [Use cases](use-cases.md). |
| Where an SSI team or a client would use it, stated modestly with what must be true: [`use-cases.md`](use-cases.md).                                                                 | `docs/hackathon/use-cases.md`                                                                   |
| Safe by default for a business: access rules are tested for every role, destructive changes need approval, releases need passing tests, nothing a model writes is executed as code. | Build tab, Tests; Release tab.                                                                  |
| The output is portable: a share link carries the app, and a build pack is one document generated from the app's state.                                                              | Share button; `changes.js` (`buildPack`), `share.js`.                                           |
| What this is not yet: the apps keep data in the browser, so they are single-user prototypes. Server storage is a later step; see ADR 1.                                             | `docs/adr/0001-state-stays-in-the-browser.md`                                                   |

### 5. Presentation and live product

| Evidence                                                                                                                                                     | Where                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Live, public, no login; opens on a working workspace.                                                                                                        | https://ssi-ai-hackathon.vercel.app/                                |
| Easy to demo with no budget: Demo mode replays saved builds. The first-run guide walks through the screens.                                                  | Title bar Live switch; guide (`src/legacy/guide.js`, `shell-c.js`). |
| Plain README with a screenshot, a diagram of the agents, a 600-character summary and run instructions.                                                       | [`README.md`](../../README.md)                                      |
| Architecture diagrams that show the orchestration: system context, containers, build sequence, one agent step, a team run, a change from chat, the pipeline. | [`docs/architecture/overview.md`](../architecture/overview.md)      |
| Every state of the product is honest about what is simulated: the About dialog lists what is real and what is simulated in Demo.                             | About dialog, "What is real in this prototype" (`shell-c.js`).      |
| Works on a phone-sized screen.                                                                                                                               | `src/legacy/mobile.js`.                                             |

## Submission text

The summary for the portal (at most 600 characters) is kept in the [`README.md`](../../README.md) under "Submission
summary". Resubmit as often as needed before the deadline: the latest version is the one evaluated.

## Level 4: toolkit

Next.js on Vercel's free plan; model access through the SSI LiteLLM gateway with `LITELLM_BASE_URL`,
`LITELLM_API_KEY` and `LITELLM_MODEL`; LangGraph for orchestration (optional in the rules, used here).
