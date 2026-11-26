# Product shape: what is built, what is not

The owner's project instructions describe the product Turnkey has to be. This page checks `main` against each
point, says where the evidence is, and lists what is still open. Audited Thu 26 Nov 2026 against `main` at
`36e73dd`. Tracking issue: #98.

Status words: **Met** means it is in `main` and a browser check covers it. **Partly** means the main idea is there
and a piece is missing. **Differs** means the product went another way on purpose; the reason is given.

## Summary

| #   | Point in the instructions                                      | Status  | Gap, and the pull request that closes it                                                    |
| --- | -------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| 1   | Main canvas and a docked chat sidebar                          | Met     |                                                                                             |
| 2   | Built with CopilotKit on the AG-UI protocol                    | Differs | Runtime is CopilotKit, chat panel is Fluent (see 2)                                         |
| 3   | One shared canvas state that agents and the owner both edit    | Met     |                                                                                             |
| 4   | An owner edit re-runs only the affected agents                 | Partly  | The owner had to press "Run again from" and confirm. Closed: re-runs start on their own (A) |
| 5   | Generative UI: agents render cards in chat                     | Met     |                                                                                             |
| 6   | Human in the loop: agents pause for approval on big trade-offs | Met     | An automatic re-run that rebuilds the database asks first (A)                               |
| 7   | Agent presence: the canvas shows which agent touched what      | Partly  | Tables always said "Created by the Database agent", even after a change. Open (B)           |
| 8   | A run timeline                                                 | Met     |                                                                                             |
| 9   | Export: one deliverable document from canvas state             | Met     |                                                                                             |
| 10  | One Next.js App Router project on Vercel, agents in process    | Met     |                                                                                             |
| 11  | Model access through LiteLLM                                   | Differs | Owner's decision of 26 Nov (see 11)                                                         |
| 12  | Canvas state lives in the browser and survives a reload        | Met     |                                                                                             |
| 13  | Spike first                                                    | Met     |                                                                                             |
| 14  | One canvas                                                     | Met     |                                                                                             |
| 15  | At most 4 agents                                               | Differs | Six builder agents, kept by the owner's decision (see 15)                                   |
| 16  | A fixed catalog of node and card types                         | Met     |                                                                                             |
| 17  | Automatic layout                                               | Met     |                                                                                             |
| 18  | Debounced re-runs to protect the spend cap                     | Partly  | Nothing was debounced. Closed (A)                                                           |

Pull requests: **A** = re-runs after a workflow edit, debounced (this page ships with it). **B** = who touched
what, per table, field and screen (next).

## Detail

### 1. Main canvas and a docked chat sidebar: Met

The app's Build view is the canvas (`src/workspace/flow.tsx`, React Flow): your request, the six stations, a check
gate after each, review steps and approvals you add, and the finished app. The Builders chat is docked on the right
(`src/workspace/shell-b.tsx`) and can be hidden. On a phone it becomes a bottom sheet (`mobile.tsx`).

### 2. CopilotKit on AG-UI: Differs, on purpose

The CopilotKit v2 runtime runs at `/api/copilotkit` with the agents registered in process
(`src/server/agui/registry.ts`), and every agent event is an AG-UI event that the Agents panel reads
(`src/platform/agui`). The chat panel itself is Turnkey's own, drawn with Fluent UI v9, not CopilotKit's chat
components. Reasons: the owner's standing rule that all UI uses Fluent 2, and that the chat shows Turnkey's own
cards (point 5), which CopilotKit's components would only wrap. Recorded in `docs/adr/0004-ag-ui-through-copilotkit.md`
and `docs/adr/0010-fluent-2-for-the-ui.md`. No change planned.

### 3. One shared canvas state: Met

Each app is one record in the store (`src/workspace/core.ts`, `S.apps[id]`): its definition (tables, endpoints,
views, pages), its workflow (`flow`), its line status and its chat. The agents write it as they build; the owner
writes it from the canvas (the options button on a station, the plus on a gate, the settings dialog) and from chat
("Add a notes field to patients", "Ask me before the screens are built"). The built app, the Details pages and the
build pack all read the same record.

### 4. An owner edit re-runs only the affected agents: Partly, closed by A

Changes to the app from chat already re-ran only the stations they touch (`src/workspace/changes.ts`,
`runChange`). A workflow edit on the canvas worked out the earliest station it touched, but then only offered a
"Run again from …" button with a confirm box. Now the re-run starts on its own (`src/workspace/rerun.tsx`): the
Build view and the chat card say which stations run again and which are kept, count down, and offer "Run now" and
"Do not run again". Browser checks in the `custom` flow.

### 5. Generative UI cards in chat: Met

Agents answer with cards from a fixed list (`src/workspace/shell-b.tsx`, `ChatCard`): brief, tables, access rules,
view plan, screens, acceptance, tests, question, approval, plan, sent back, changed, error, workflow, gate, review,
released, ready. Options, approvals and summaries are all there.

### 6. Human in the loop: Met

The Researcher pauses the line with a question when a decision is the owner's (the "Your call" card). The owner can
put an approval after any station; the line waits at it. A change that deletes data waits for a yes
(`changes.ts`, `askApproval`). A re-run that would rebuild the database, and so replace its records, is never started
on its own: it asks first (A).

### 7. Agent presence: Partly, B is open

Met: each station on the canvas carries its agent's icon, colour and status (Working, Needs you, Sent back,
Passed); the Agents panel (`activity.tsx`) shows who is working, on which step, with tool calls and hand-offs; the
chat names the agent on every message. Missing: what each agent made is not marked on the result. The Data page says
"Created by the Database agent from the definition" for every table, even one you changed by chat a minute ago, and
fields, endpoints and screens say nothing. B records, for each table, field, endpoint and screen, which agent made
it or last changed it, and whether you asked for it, and shows that where the item is listed.

### 8. Run timeline: Met

The Build view has Workflow, Timeline and Log tabs (`shell-a.tsx`). The Timeline shows who worked when; the Log
lists every step; each station's Attempts tab shows the attempts and the checks that sent work back.

### 9. Export one deliverable document: Met

The build pack (`changes.ts`, `buildPack`) is one Markdown document generated from the app's state: brief, SQL,
workflow, endpoints, screens and the acceptance test. From the More menu or the ready card; copy or download.

### 10. Stack: Met

One Next.js 16 App Router project, deployed to Vercel on release. CopilotKit runtime in a route handler, agents
in process, no separate Python server.

### 11. LiteLLM: Differs, by the owner's decision

The gateway (`src/server/llm`) supports LiteLLM through an OpenAI client with a custom base URL, as the
instructions say. On 26 Nov the owner chose to skip LiteLLM for now: the Claude Code CLI locally and an Anthropic key
on the deployed site. Switching back is a matter of environment variables.

### 12. State in the browser: Met

Saved to IndexedDB, with localStorage as the fallback and still readable (`src/platform/storage`). Each app's data
is a SQLite database in the browser. A reload keeps everything (`misc` flow).

### 13. Spike first: Met

Pull request #1: a streamed tool call updating canvas state through CopilotKit and LiteLLM. Still at `/spike`.

### 14. One canvas: Met

One canvas per app, in its own tab.

### 15. At most 4 agents: Differs, by the owner's decision

A build has six builder agents (Researcher, Database, Backend, View advisor, UI, Tester), plus up to four optional
review steps the owner adds and the app's own agent team. The Orchestrator is code. The judging criteria reward
"agents with distinct roles hand work to each other and check each other", and the six-agent line is what the
prototype the owner approved was built on. On 26 Nov the owner chose to keep six; the limit of four is raised on
purpose.

### 16. Fixed catalog: Met

Stations come from a fixed list (`line.ts`, `STATIONS`), review steps from `REVIEWERS` (`custom.tsx`), card types
from point 5, view types from 14 fixed kinds (`views-a.tsx`, `views-b.tsx`). Agents return JSON that code validates;
nothing an agent writes is run as code.

### 17. Automatic layout: Met

The canvas places every node itself (`flow.tsx`): stations in rows, gates under them, review steps where they act.
The owner can drag nodes and press Reset layout.

### 18. Debounced re-runs: Partly, closed by A

Nothing waited before a re-run, so each edit could cost a run. Now a workflow edit waits five seconds; each further
edit restarts the wait, and one run starts from the earliest station any of them touched. A re-run that is due while
another run is going waits for it. The server's guard rails (rate limits, daily cap) stay as the second line.
