# Model gateway

Every model call in Turnkey goes through this folder. Server only: nothing here may be imported from `src/platform`,
`src/legacy` or a client component.

## Choosing a model

Set `LLM_PROVIDER`, or leave it unset and the first that applies is used: Anthropic (`ANTHROPIC_API_KEY` set), LiteLLM
(all three `LITELLM_*` set), OpenAI, then, on a developer's machine only, the Claude Code command if it is installed,
then the stand-in.

For now (26 Nov) the backends in use are the **Claude Code command** on a developer's machine (no key: it uses your
Claude login) and a **Claude API key** on the deployed site (set `ANTHROPIC_API_KEY` in Vercel). LiteLLM stays
available for later: set its three variables and `LLM_PROVIDER=litellm`, or remove the Anthropic key.
`/api/health` says which one answers in `backend`. In
production with nothing configured there is no provider: the app works on its saved builds and Live says that no
model is connected.

Sonnet is used for planning and building roles (`default`), Haiku for fast and validator roles (`quick`).

## Claude features (features.ts)

| Feature         | What the gateway does                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Effort per tier | `default` thinks at `medium`, `quick` at `low`; `ChatRequest.effort` overrides it for one call (say `high` for the planner). LiteLLM: `reasoning_effort` (dropped and remembered if the gateway refuses it). Anthropic: `output_config.effort`. Claude Code: `--effort`. |
| Prompt caching  | The system prompt (role prompt, catalog, tool list) is marked `cache_control: ephemeral`; the conversation after it is not. Put the stable part in the system prompt and the canvas state in the last user message. `cache: false` turns it off for a one-off call.      |
| No sampling     | `temperature`, `top_p`, `top_k` are never sent: current Claude models refuse them.                                                                                                                                                                                       |
| Tool choice     | Always `auto`. Opus 5.5 and Sonnet 5.5 refuse a forced choice, so `toolChoice: 'required'` is said in the system prompt instead.                                                                                                                                         |
| Usage and cost  | Every call ends with `usage: { input, output, cacheRead, cacheWrite, costUsd }` (`input` is the uncached part). One line per call goes to the server log, and `/api/health` shows `spend` against the $25 budget. See below.                                             |

Effort and caching are sent to OpenAI-compatible endpoints only for Claude model names, so OpenAI itself is unaffected.

| To run with                                | Set                                                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the SSI LiteLLM gateway                    | `LITELLM_BASE_URL` (with `/v1`), `LITELLM_API_KEY`, `LITELLM_MODEL` (`claude-sonnet-5-5`); optional `LITELLM_MODEL_FAST` (default `claude-haiku`), `LLM_GATEWAY_RPM` (default 55, the gateway allows 60)                |
| OpenAI, or any service that speaks its API | `OPENAI_API_KEY`, `OPENAI_MODEL`; optional `OPENAI_MODEL_FAST`, `OPENAI_BASE_URL`                                                                                                                                       |
| Anthropic                                  | `ANTHROPIC_API_KEY`; optional `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `ANTHROPIC_MODEL_FAST`, `ANTHROPIC_BASE_URL`                                                                                             |
| the Claude Code command                    | `LLM_PROVIDER=claude-code` (`claude-cli` still accepted); optional `CLAUDE_CODE_MODEL` (default `sonnet`), `CLAUDE_CODE_MODEL_FAST` (default `haiku`). Development only: refused in production and when `VERCEL` is set |
| the stand-in                               | `LLM_PROVIDER=mock`. No key, no network. Answers Turnkey's own agent prompts with valid saved answers, so a whole Live build runs                                                                                       |

Keys live in `.env.local` and in Vercel's settings. They are never logged, never sent to the browser, and never in
a `NEXT_PUBLIC_` variable. Error messages sent to the browser carry no address and no key.

`GET /api/health` says which provider and models are in use. `?probe=1` makes one real tool call on the fast model
and reports pass or fail, the time taken, and whether tools go natively or by the JSON protocol (`?probe=tools` is the same).

## Using it from server code

```ts
import { complete, resolveProvider } from '@/server/llm';

const provider = resolveProvider(); // null when nothing is configured
const { text, truncated, usage, toolCalls } = await complete(provider, { messages, tier: 'default', tools });
for await (const chunk of provider.stream(request)) {
  /* delta | tool_call | done */
}
```

- `toChatModel(tier)` from `@/server/llm/chat-model`: a LangChain chat model for LangGraph nodes (`bindTools` works).
- `toAiSdkModel(tier)` from `@/server/llm/ai-sdk`: an AI SDK model for CopilotKit's built-in agent. `src/lib/model.ts` uses it.

## Tools

Pass `tools` (name, description, JSON Schema) and read `tool_call` chunks back. Where the provider has native tool
calling it is used; otherwise the tools are described in the system prompt and the reply is read as JSON. The caller
sees the same thing either way. `LLM_TOOL_MODE=auto` (default) probes once per provider and model and remembers;
`native` and `json` force one way.

## Token and cost logging (usage.ts)

Every provider from `resolveProvider()` is wrapped by `withUsage`. When a call ends it is priced (the Claude Code
command's own `total_cost_usd`, else the price table in features.ts), logged, and added to running totals:

```
[llm] litellm claude-sonnet-5-5 default/medium in=812 out=240 cache_read=3100 cache_write=0 $0.004290 1820ms
```

The line never holds the prompt, the answer, a key or an address. `LLM_LOG_USAGE=0` turns it off. `GET /api/health`
returns `spend: { calls, input, output, cacheRead, cacheWrite, costUsd, unpriced, budgetUsd, since }`; the totals are
per server instance (on Vercel, since that instance started) and are for watching, not enforcing: the guard does that.
`LLM_BUDGET_USD` changes the budget shown (default 25).

## Retries and limits

A 429 or a 5xx is retried with backoff (0.5 s, 1 s), honouring `Retry-After`, at most three tries in all. A request
pacer keeps one server instance under the gateway's 60 requests a minute. The per-visitor and daily limits are in
`src/server/guard/limits.ts`.

## Tests

No network. `tests/unit/llm-features.test.ts` covers each Claude feature above. Providers are tested with recorded streams; the Claude Code command with a fake child process. The mock's saved
answers are checked by running a whole build through the workspace's own checks (`tests/unit/mock-roles.test.ts`).

## The Claude Code provider

`providers/claude-code.ts` runs `claude -p --output-format stream-json` with no built-in tools, the prompt on standard input
and at most three attempts per step. Requests with tools use `--json-schema`: the model answers `{tool_calls}` or
`{text}` and the result becomes normal `tool_call` chunks. `--bare` is added only when `ANTHROPIC_API_KEY` is set (bare
mode ignores the Claude login). `maxTokens` cannot be set through the command and is not applied. The command caches
the system prompt itself. To see it, run `LLM_LIVE=1 npx vitest run tests/unit/llm-live.test.ts`: two real calls on
Haiku with the same long system prompt; the second reads it from the cache (about a tenth of a US cent in all).
