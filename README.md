# Turnkey

Describe an app in plain words; agents build it on a shared canvas.
Next.js App Router + CopilotKit (AG-UI) with an in-process agent, models through LiteLLM.

## Spike (current state)

One streamed tool call from the model updates shared canvas state:

1. You type in the chat sidebar.
2. `app/api/copilotkit/[[...slug]]/route.ts` runs the Architect agent (CopilotKit `BuiltInAgent`)
   against LiteLLM's OpenAI-compatible endpoint (`lib/model.ts`).
3. The model calls the frontend tool `add_canvas_node` (fixed catalog of node kinds, `lib/canvas.ts`).
   Its arguments stream over AG-UI to the browser.
4. The browser adds the node to the canvas, mirrors it into AG-UI shared state, and saves it to localStorage.

`GET /api/health` checks the LiteLLM setup: it makes one plain tool call with the OpenAI client and
reports whether the model returned a tool call (no secrets in the response).

## Setup

Environment variables (server-only, never `NEXT_PUBLIC_`), in Vercel → Settings → Environment Variables
or `.env.local` locally:

| Name | Example |
|---|---|
| `LITELLM_BASE_URL` | `https://your-litellm-host/v1` |
| `LITELLM_API_KEY` | your LiteLLM key |
| `LITELLM_MODEL` | a model name your key can use |

```bash
npm install
npm run dev
```
