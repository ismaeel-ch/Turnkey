# Pre-submission audit

Run on Thu 26 Nov 2026, 21:10 to 21:45 UTC (Fri 27 Nov, 02:10 to 02:45 PKT), against `main` at `2e19715` (#114).
Method: `.claude/skills/hackathon-check/SKILL.md`, a security review of every API route, a secrets scan over the full
git history of every branch, and the kickoff deck's Level 1 rules and Level 2 filter
(`/mnt/project-files/artifacts/hackathon/agent-a-thon-kickoff.txt`). Earlier runs are in `checklist.md`.

**Result: every filter check passes on the code and the live site, with one rule the owner should decide on before
submitting: the deployed site calls Claude with a direct Anthropic key, not the SSI LiteLLM key (see "For Ismaeel").**

## Level 2 filter

| Check                                   | Result                 | Evidence                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your own individual work                | PASS                   | `ismaeel-ch/Turnkey`, owned by the entrant. Deployed from the owner's Vercel project `turnkey` by the release workflow.                                                                                                                                                                                                                                        |
| No client or internal data              | PASS, owner to confirm | Seed data (`src/workspace/builds.ts`, `quests.ts`) and connector fixtures are made up or public; unchanged since run 2. Person and organisation names in samples look invented; only the owner can confirm none is real.                                                                                                                                       |
| No API key in the code                  | PASS                   | `npm run check:secrets`: 336 files, nothing found. `--history`: nothing. A key-pattern search (`sk-ant-`, `sk-…`, `ghp_`, `github_pat_`, AWS, Slack, Google, Blob tokens, private keys) over all 261 commits on every branch finds only the scanner's own regex. Only `.env.example` was ever tracked, with no values.                                         |
| Live on a public URL                    | PASS                   | https://turnkey-bay.vercel.app. Release v0.3.2 (run 45892796372) deployed and its health check answered `{"ok":true,"version":"0.3.2","commit":"175029f","live":true,...}`; the smoke job passed.                                                                                                                                                              |
| Safe AI-agent settings                  | PASS                   | `.claude/settings.json`: `defaultMode: acceptEdits`; deny rules for reading and editing `.env`, `.env.local`, `.env.*.local`, force pushes and pushes to `main`; bash and file guard hooks.                                                                                                                                                                    |
| Agentic, not a single prompt            | PASS                   | Six builder agents, each with its own model call through the server step agent (`/api/copilotkit`, agent `step`: draft, validate, repair), compiled into a LangGraph workflow (`src/platform/orchestrator`, `src/workspace/line.ts`) with checks, send-backs and approvals. App teams run on the server with tool calls to public sources (`/api/agent/team`). |
| Works end to end                        | PASS                   | CI on #114's head `6e9ae4c`: `check` and all 12 browser flows green (a11y, custom, demo, live, misc, new, offline, quests, react, round6, sizes, views). `npm run check` passes locally on `2e19715`.                                                                                                                                                          |
| App stays up, no crashes                | PASS (so far)          | Five production deploys today, each with a passing health check. Works with no model (CLAUDE.md rule 6, the `demo` flow). Keep watching after each release (workstream J).                                                                                                                                                                                     |
| Public GitHub repo that matches the app | PASS, needs a release  | Repo is public. Live runs `175029f` (v0.3.2), which is on `main`; `main` has moved on by several merges. **Cut a release after the last merge** so `/api/health` `commit` equals the head of `main` at submission.                                                                                                                                             |

## Level 1 rules

| Rule                                                            | Result             | Notes                                                                                                                                                  |
| --------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agents that plan, call tools and act "through your LiteLLM key" | **OWNER DECISION** | The site runs on `ANTHROPIC_API_KEY` (health: `"provider":"anthropic"`). LiteLLM support is built and tested; switching is only environment variables. |
| Public or made-up data only                                     | PASS               | See the filter.                                                                                                                                        |
| Live, no login                                                  | PASS               | No sign-in to an outside service. The in-app demo sign-in is part of the generated app, with a "Skip" path.                                            |
| Working end to end, each agent's steps shown                    | PASS               | Build tab: Workflow canvas, Timeline, Log; agent cards in chat; Debug drawer; which agent made each table, field and screen (#114).                    |
| Individual work, public repo, key in env vars, Accept Edits     | PASS               | See the filter.                                                                                                                                        |
| "No other paid tools"                                           | **OWNER DECISION** | Same as the LiteLLM row: a personal Anthropic key is a paid tool outside the $25 organiser budget. Vercel and Vercel Blob are on the free tier.        |

## Security review

Every route under `src/app/api` and `src/app/a` was read.

| Area                   | Finding                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model routes           | `/api/llm`, `/api/agent/step`, `/api/copilotkit`, `/api/agent/team`: cross-site refusal, per-visitor, global, daily-call and daily-dollar limits, body size caps, zod validation. Prompt policy on the first three; team policy on the fourth. OK.                        |
| Visitor key            | First `x-forwarded-for` address, cut to 64 characters. Vercel overwrites that header, so it cannot be forged there; the global and dollar caps bound the rest. OK.                                                                                                        |
| Share routes           | Slugs must match a strict pattern before any store read, so no path traversal in the folder store; saves need the owner token to overwrite; daily quotas. OK.                                                                                                             |
| Icon and manifest      | Only catalog values reach the drawing; SVG served with `sandbox` CSP and `nosniff`. OK.                                                                                                                                                                                   |
| Connectors             | Fixed list of public sources; only the query and a count are forwarded; light rate limit. OK.                                                                                                                                                                             |
| Headers                | CSP `default-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, HSTS, COOP, Permissions-Policy. `script-src` keeps `'unsafe-inline'` because Next.js inlines its boot scripts and pages stay static; documented in `headers.ts`. Accepted. |
| `NEXT_PUBLIC_`         | None declared. Two comments forbid them.                                                                                                                                                                                                                                  |
| Server code in browser | No browser or shared file imports `src/server`. **Fixed in this PR:** a lint rule now enforces it (`eslint.config.mjs`).                                                                                                                                                  |
| `npm audit --omit=dev` | 21 high, all inside CopilotKit's and Vercel's own dependency trees (their pinned `zod@3`, `undici`, `graphql-scalars`, `@fastify/busboy`). Turnkey's own `zod` is 4.6.7 (patched). None is reachable from a request Turnkey accepts. Left to #89.                         |
| SECURITY.md            | Was out of date (named only `/api/llm` and LiteLLM, no dollar cap, cross-site refusal, team policy or share quotas). **Fixed in this PR.**                                                                                                                                |

## Issues

- Closed as done, with evidence: #23 (no live URL: five deploys since), #47 (release health check now asks `turnkey-bay`), #17 (server agents and workflow graph are wired; the `live` flow runs them).
- Still open and owned by other workstreams: #98 spec gaps, #93 error handling, #89 dependencies (npm audit), #81, #85, #94.

## For Ismaeel (only you can do these)

1. **Decide on the model key.** The rules say agents run "through your LiteLLM key" and the deck lists the LiteLLM
   key as the toolkit, with "no other paid tools". The live site uses a direct Anthropic key. To switch, in Vercel →
   `turnkey` → Settings → Environment Variables: add `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL=claude-sonnet-5-5`,
   `LITELLM_MODEL_FAST=claude-haiku`, then remove `ANTHROPIC_API_KEY` (or set `LLM_PROVIDER=litellm`), and cut a
   release. `/api/health` should then say `"provider":"litellm"`. Asking the organisers is the safe way to settle it.
2. **Set a spend limit on whichever key is live** (Claude Console workspace limit, or the gateway's $25). The app's
   own caps are per server instance and are a brake, not a hard stop.
3. **Turn on private vulnerability reporting** (repo Settings → Code security → Private vulnerability reporting).
   SECURITY.md points reporters there, and this session is not allowed to change that setting.
4. **Confirm the sample names are invented** (people and organisations in the sample apps).
5. **After the last merge, make sure a release has deployed it**, then check that `/api/health` `commit` matches
   `main`. Then submit on the portal: repo URL, `https://turnkey-bay.vercel.app`, and the summary in
   `docs/hackathon/submission.md`. You can resubmit until Mon 30 Nov, 2:00 PM PKT.
6. Optional: branch protection on `main` is off. The agent settings already deny pushes to `main`; turning protection
   on now could block the overnight merge flow, so leave it until after submission.
