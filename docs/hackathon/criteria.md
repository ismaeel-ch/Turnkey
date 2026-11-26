# Hackathon rules and scoring: where this entry stands

Source: the Agent-A-Thon 2026 kickoff deck (26 Nov 2026) and the portal's rules and guide pages. The docs-architect
agent keeps this page current; the compliance-auditor checks it after each milestone.

## Dates

- Build window opens: Fri 27 Nov 2026, 12:00 AM PKT
- Submissions close: **Mon 30 Nov 2026, 2:00 PM PKT** (the latest submitted version is the one evaluated)
- Submit: GitHub repo URL, live production URL, summary of up to 600 characters

## Level 1: must-haves and rules

| Requirement                                                                                                     | How this repo meets it                                                                                           | Where to look                                                    |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Agentic solution: agents plan, call tools and act on results through the LiteLLM key; multi-agent scores higher | six builder agents on a workflow, each checked by code and sent back on failure; apps have their own agent teams | `src/workspace/line.ts`, `tester.tsx`, `team.tsx`; `src/server/graph` |
| Public or made-up data only                                                                                     | agents invent seed data; quest apps read public sources only                                                     | `src/server/connectors`                                          |
| Live on a public URL, usable with no login                                                                      | one Next.js project on Vercel; the workspace's own sign-in is a local demo account, no outside account needed    | live URL, `/api/health`                                          |
| Working end to end; each agent's steps shown in the app                                                         | workflow canvas, timeline, debug drawer; saved builds work with no model                                         | the Build tab                                                    |
| Individual work, own repo, own Vercel account                                                                   | solo entry                                                                                                       | repository owner                                                 |
| Public GitHub repo with code and docs                                                                           | this repository                                                                                                  |                                                                  |
| Key in environment variables, never committed                                                                   | read only in `src/server/llm`; scan in CI                                                                        | `scripts/check-secrets.mjs`, `.env.example`                      |
| Safe AI-agent settings: Accept Edits, not full auto                                                             | project settings set it and deny reading env files and pushing to `main`                                         | `.claude/settings.json`, `.claude/hooks`                         |
| App stays up through judging; budget also covers judging                                                        | caps on model calls; Demo mode needs no model                                                                    | `src/server/guard/limits.ts`                                     |

## Level 2: scoring (five criteria, 1 to 10 each, equal weight)

| Criterion                                         | What judges look for                                         | Evidence (to be filled in as milestones land) |
| ------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Completeness, including multi-agent orchestration | works end to end; agent handoffs; agents checking each other |                                               |
| Technical execution                               | clean build, sensible agents, key out of the code            |                                               |
| Creativity and uniqueness                         | fresh, specific idea                                         |                                               |
| Business value                                    | someone at SSI or a client would use it                      |                                               |
| Presentation and live product                     | live, public, easy to demo                                   |                                               |

## Level 3: use cases

The three suggested quests ship as three apps built by Turnkey, each with its own agent team:
Fact-checking (Extractor, Researcher, Verifier), Prior-art scout (Search, Analyst, Critic) and Skeptical debate
partner (For, Against, Moderator). Turnkey itself is the "bring your own idea" entry: the tool that builds such apps.

## Level 4: toolkit

Next.js on Vercel's free plan; model access through the SSI LiteLLM gateway with `LITELLM_BASE_URL`,
`LITELLM_API_KEY` and `LITELLM_MODEL`; LangGraph for orchestration (optional in the rules, used here).
