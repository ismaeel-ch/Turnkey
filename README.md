# Turnkey

Describe the app your work needs. A team of agents builds its database, backend rules, views, pages and tests on a
workflow you can watch and change, and hands it over as a working app. Built for the SSI Agent-A-Thon 2026.

- **Workspace** at `/`: the full product. It runs on saved builds with no model configured, and on live agents
  once a model key is set on the server.
- **Spike** at `/spike`: one streamed tool call from the model that updates shared canvas state, through CopilotKit
  (AG-UI) and LiteLLM. Kept as the proof that the stack works end to end.

How it is built, who builds what and in which order: [`docs/PLAN.md`](docs/PLAN.md).
How it meets the hackathon rules and scoring: [`docs/hackathon/criteria.md`](docs/hackathon/criteria.md).

## Run it

```bash
npm ci
npm run dev                      # http://localhost:3000, saved builds only
LLM_PROVIDER=mock npm run dev    # a stand-in model: no key, no network, no cost
```

To use a real model, copy `.env.example` to `.env.local` and fill in the names below. On Vercel, set the same names
under Settings → Environment Variables for Production and Preview, then redeploy.

| Name                 | Meaning                                         |
| -------------------- | ----------------------------------------------- |
| `LITELLM_BASE_URL`   | the gateway address, including `/v1`            |
| `LITELLM_API_KEY`    | your personal key                               |
| `LITELLM_MODEL`      | a model your key can use, for careful work      |
| `LITELLM_MODEL_FAST` | optional: a cheaper model for the Quick setting |

Keys are read only by server code. Never commit one, never put one in a `NEXT_PUBLIC_` variable.

Check a deployment:

| Address                   | Tells you                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `/api/health`             | the app is up, whether a model is configured, which commit is deployed. Costs nothing. |
| `/api/health?probe=1`     | one tiny model call: is the key accepted and the model name right                      |
| `/api/health?probe=tools` | one tool call: can the configured model call tools, and which models the key can see   |

## Check your work

```bash
npm run check                 # secrets scan, lint, typecheck, unit tests
npm run test:e2e -- demo      # one of the eight browser flows; all 286 checks run in CI
```

## The spike

One streamed tool call from the model updates shared canvas state:

1. You type in the chat sidebar on `/spike`.
2. `src/app/api/copilotkit/[[...slug]]/route.ts` runs the Architect agent (CopilotKit `BuiltInAgent`, in process)
   against LiteLLM's OpenAI-compatible endpoint (`src/lib/model.ts`).
3. The model calls the frontend tool `add_canvas_node` (fixed catalog of node kinds, `src/lib/canvas.ts`).
   Its arguments stream over AG-UI to the browser.
4. The browser adds the node to the canvas, mirrors it into AG-UI shared state, and saves it to localStorage.

## Layout

```
src/app/(workspace)   the workspace page          src/server    model gateway, guard rails (server only)
src/app/(spike)       the spike page              src/platform  React compatibility layer, boot, model client
src/app/api           health, llm, copilotkit     src/legacy    the workspace modules, ported unchanged
tests/unit, tests/e2e                             .claude       agents, skills, rules, hooks for Claude Code
```
