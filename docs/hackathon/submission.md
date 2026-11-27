# Submission

What goes into the Agent-A-Thon portal, and what to check before pressing submit. Submissions close
**Mon 30 Nov 2026, 2:00 PM PKT**. The latest submitted version is the one evaluated, so submit early and again after
the final release.

## The three fields

| Field             | Value                                   |
| ----------------- | --------------------------------------- |
| GitHub repository | https://github.com/ismaeel-ch/Turnkey   |
| Live URL          | https://turnkey-bay.vercel.app/         |
| Summary           | the text below (at most 600 characters) |

## Summary

Copy the text inside the box. It is 570 characters, counted with spaces. The same text is in the README and in
the project's `submission/summary.md`.

```text
Turnkey turns one sentence into a working business app. A Planner agent asks a few questions and shows a plain-words plan; once the owner approves, code picks the team (lists, rules, views, screens, tests, access) and a LangGraph workflow streams every step over AG-UI. Code checks each handoff and sends failed work back; failing tests go back for repair. Each app opens with a welcome per role and removable demo data. After release 1.0, a fix gets a plan, a draft and release 1.1. Built apps can carry agent teams that search public sources. Demo mode needs no model.
```

Every claim in it is on `main` and in release v0.5.0: the Planner's questions and plan (`src/workspace/planner.ts`,
`src/workspace/interview.ts`, `src/shared/plan`), the team picked by code from the plan (`teamFor` in
`src/shared/plan/team.ts`), the build held to the plan (`src/shared/plan/build.ts`), the workflow graph
(`src/platform/orchestrator`), AG-UI streaming (`src/platform/model-client.ts`, `src/server/agui`), the checks and
send-backs (`src/workspace/line.ts`), the Tester's repair (`src/workspace/tester.tsx`), the welcome for each role
(`src/workspace/firstrun.tsx`), removable demo data (`src/workspace/demo-data.ts`), fixes after a release
(`src/workspace/improve.tsx`, `src/workspace/release.tsx`), team lookups (`src/server/graph/team/connector-tools.ts`)
and Demo with no model.

## Before pressing submit

Each line is checked by a person or by the audit (`.claude/skills/hackathon-check/SKILL.md`, results in
[`checklist.md`](checklist.md)).

1. The last pull request is merged and a release is cut after it, so the live app is the code in the repository.
2. `<live URL>/api/health` answers `ok: true`, and its `commit` equals the head of `main`.
3. `<live URL>/api/health?probe=1` passes: the key in Vercel is accepted and the model name is right.
4. One guided Live build on the live URL finishes: questions, plan, build, first use, demo data removed, release 1.0,
   a change and release 1.1. The "Live site check" action with its `guided` input walks exactly this (about 8 model
   calls). Then one team run in a quest app, whose case header shows what its model calls cost. Turn Live off again.
5. With Live off, the clinic sentence goes through its question and plan, builds, and opens on Sara's welcome; a
   saved build runs, its app opens, and Release and Share work. The "Judge walk" action (Actions,
   Judge walk, Run workflow) checks both paths (the guided clinic build, then Try a sample) on the live site by clicking through them, 34 steps, and must pass.
6. Details, Connections, Microsoft Learn, Test on the live site returns real results from learn.microsoft.com.
7. The repository is public and the README opens on the live URL and the summary.
8. Nothing in the repository holds a key (`npm run check:secrets`), and no data in it is real client or company data.
9. The app stays up until winners are announced. The guard rails cap spend. If the budget runs low, set
   `LIVE_MODE=off` in Vercel and redeploy the current tag (Actions, Release and deploy, Run workflow): model calls stop
   and every saved build still works.
