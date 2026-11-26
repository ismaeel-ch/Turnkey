# Model gateway

Every model call in Turnkey goes through this folder. Server only: nothing here may be imported from `src/platform`,
`src/legacy` or a client component.

## Choosing a model

Set `LLM_PROVIDER`, or leave it unset and the first that applies is used: LiteLLM (all three `LITELLM_*` set), OpenAI,
Anthropic, then, on a developer's machine only, the Claude Code command if it is installed, then the stand-in. In
production with nothing configured there is no provider: the app works on its saved builds and Live says that no
model is connected.

Sonnet is used for planning and building roles (`default`), Haiku for fast and validator roles (`quick`). `temperature`
is never sent: current Claude models reject any value but the default. Tools are always `auto`; nothing forces a tool.

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

## Retries and limits

A 429 or a 5xx is retried with backoff (0.5 s, 1 s), honouring `Retry-After`, at most three tries in all. A request
pacer keeps one server instance under the gateway's 60 requests a minute. The per-visitor and daily limits are in
`src/server/guard/limits.ts`.

## Tests

No network. Providers are tested with recorded streams; the Claude Code command with a fake child process. The mock's saved
answers are checked by running a whole build through the workspace's own checks (`tests/unit/mock-roles.test.ts`).

## The Claude Code provider

`providers/claude-code.ts` runs `claude -p --output-format stream-json` with no built-in tools, the prompt on standard input
and at most three attempts per step. Requests with tools use `--json-schema`: the model answers `{tool_calls}` or
`{text}` and the result becomes normal `tool_call` chunks. `--bare` is added only when `ANTHROPIC_API_KEY` is set (bare
mode ignores the Claude login). `maxTokens` cannot be set through the command and is not applied.
