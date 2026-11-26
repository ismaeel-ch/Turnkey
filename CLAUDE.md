# Turnkey

Turnkey turns one sentence into a complete, working business app: database, backend rules, views, pages and tests.
A team of agents builds it on a workflow the owner can watch and change. It is Muhammad Ismaeel's solo entry for the
SSI Agent-A-Thon 2026. **Submissions close Mon 30 Nov 2026, 2:00 PM PKT.**

Read `docs/PLAN.md` before starting work. It holds the architecture, the work packages and who owns which folders.
If you are one of several agents working in parallel, `docs/RUNBOOK.md` says how: GitHub commands that work here,
git rules, the shared machine, and the flow of one work package.

## Commands

| Command                    | What it does                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `npm ci`                   | install (use this, not `npm install`, unless you are changing dependencies)                   |
| `npm run dev`              | local server on http://localhost:3000                                                         |
| `npm run build`            | production build; also what Vercel runs                                                       |
| `npm run check`            | secrets scan, lint, typecheck, unit tests. **Run before every push.**                         |
| `npm run test:e2e -- demo` | one browser flow (`demo live misc views quests new custom round6`), about 2 to 4 minutes each |

Run with a stand-in model, no key needed: `LLM_PROVIDER=mock npm run dev`.

## Layout

```
src/app/        Next.js App Router: the page and the API routes (server code)
src/workspace/  the workspace UI: ES modules with JSX, ported from the prototype (one file per former module)
src/platform/   browser-side helpers: DOM rendering, sql.js loader, model client, and new browser features
src/server/     server-only code: model gateway, guard rails, LangGraph graphs, AG-UI stream, connectors
src/shared/     types and zod schemas used by both sides
tests/unit/     vitest
tests/e2e/      the 286 browser checks (flows.cjs) and their runner
docs/           plan, architecture, decisions, hackathon checklist
```

## Rules that have no exceptions

1. **No secrets in the repo.** Keys live in `.env.local` (ignored) and in Vercel's environment variables. Never write
   a key into code, tests, docs, commit messages, logs or screenshots. Never create a `NEXT_PUBLIC_` variable.
   `npm run check:secrets` must pass.
2. **The browser never calls a model provider.** Model calls happen only in `src/app/api/**` and `src/server/**`.
   Nothing in `src/server` may be imported from `src/platform`, `src/workspace` or a client component.
3. **Public or made-up data only.** No client, customer or internal company data, not even in a test fixture.
4. **No direct pushes to `main`.** Work on a branch, open a pull request that names its issue, merge when CI is green.
5. **`src/workspace` is ordinary code.** It began as the prototype's plain-script modules and is now typed module by
   module, split into components, with its mutable store moved to an external store. Keep each change covered by the
   browser flows in `tests/e2e` that exercise it, and keep them green. Remove `// @ts-nocheck` from a file only when
   that file type-checks.
6. **The app must work with no model configured.** With no key, every saved build and every screen still works, and
   Live says plainly that no model is connected. Nothing may crash on a missing environment variable.
7. **Stay in your folders.** `docs/PLAN.md` lists what each agent owns. To change a file you do not own, ask in your
   issue or leave it to the supervisor. `package.json` and the lockfile: add what you need, touch nothing else.
8. **Cap every loop** that calls a model: at most three attempts per step. The budget is small and does not refill.

## How to work

- Before using an API of Next.js, LangGraph, AG-UI or any library, read the version that is installed:
  `node_modules/next/dist/docs/`, the package's `.d.ts` files, its README. These libraries change often and what you
  remember may be out of date. This project is on Next.js 16 and React 19.
- TypeScript, strict. No `any` without a comment saying why. Validate everything that crosses a boundary (request
  bodies, model output, connector responses, share links) with zod or a hand-written normaliser.
- Write the test with the code. Server and shared code: vitest in `tests/unit`. Behaviour of the workspace: a check in
  `tests/e2e/flows.cjs`.
- Names and UI text are plain English. No jargon, nothing that sounds like marketing or like an AI wrote it.
- Small pull requests. One issue, one branch, one purpose. Say in the description what you verified and how.
- Heavy commands (`npm run build`, `npm run test:e2e`) must be wrapped in `scripts/heavy.sh` when several agents
  share one machine: `scripts/heavy.sh npm run build`. It queues them so the machine is not overloaded.

## Hackathon rules this repo must always satisfy

Agentic and multi-agent, with each agent's steps visible in the app. Live on a public URL with no login. Works end to
end. Public GitHub repo that matches the deployed app. Key kept out of the code. Accept Edits mode for local AI
agents (`.claude/settings.json` sets it). Scoring is five criteria of equal weight: completeness including
multi-agent orchestration, technical execution, creativity, business value, presentation and live product.
Details and evidence: `docs/hackathon/criteria.md`.
