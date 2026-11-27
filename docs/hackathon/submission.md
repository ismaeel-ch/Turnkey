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

Copy the text inside the box. It is 582 characters, counted with spaces. The same text is in the README and in
the project's `submission/summary.md`.

```text
Turnkey turns one sentence into a working business app: SQLite database, role-guarded backend, views, pages and tests. Five builder agents and a Tester run on a LangGraph workflow the owner can watch and edit, and every step streams over AG-UI. Code checks each handoff and sends failed work back, failing tests go back to the Backend for repair, and the owner approves big trade-offs. Canvas edits re-run only the agents they touch. Built apps get agent teams of their own that look up public sources: fact-check, prior-art, debate, bidding, grant review. Demo mode needs no model.
```

Every claim in it is on `main` and in release v0.4.6: the workflow graph (`src/platform/orchestrator`), AG-UI streaming
(`src/platform/model-client.ts`, `src/server/agui`), the checks and send-backs (`src/workspace/line.ts`), the Tester's
repair (`src/workspace/tester.tsx`), approvals (`src/workspace/custom.tsx`), canvas edits that re-run only the touched
stations (`editFromCanvas` in `src/workspace/changes.ts`: fields on the Data page, the Look menu on the App page), team lookups
(`src/server/graph/team/connector-tools.ts`) and Demo with no model.

## Before pressing submit

Each line is checked by a person or by the audit (`.claude/skills/hackathon-check/SKILL.md`, results in
[`checklist.md`](checklist.md)).

1. The last pull request is merged and a release is cut after it, so the live app is the code in the repository.
2. `<live URL>/api/health` answers `ok: true`, and its `commit` equals the head of `main`.
3. `<live URL>/api/health?probe=1` passes: the key in Vercel is accepted and the model name is right.
4. One Live build on the live URL finishes (the clinic sample is a short one), and one team run in a quest app, whose
   case header shows what its model calls cost. Then turn Live off again.
5. With Live off, a saved build runs, its app opens, and Release and Share work. The "Judge walk" action (Actions,
   Judge walk, Run workflow) checks this path on the live site by clicking through it, 23 steps, and must pass.
6. Details, Connections, Microsoft Learn, Test on the live site returns real results from learn.microsoft.com.
7. The repository is public and the README opens on the live URL and the summary.
8. Nothing in the repository holds a key (`npm run check:secrets`), and no data in it is real client or company data.
9. The app stays up until winners are announced. The guard rails cap spend. If the budget runs low, set
   `LIVE_MODE=off` in Vercel and redeploy the current tag (Actions, Release and deploy, Run workflow): model calls stop
   and every saved build still works.
