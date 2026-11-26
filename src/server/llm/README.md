# Model gateway

Every model call in Turnkey goes through this folder. Server only: nothing here may be imported from `src/platform`,
`src/legacy` or a client component.

## Choosing a model

Set `LLM_PROVIDER`, or leave it unset and the first configured of LiteLLM, OpenAI and Anthropic is used. With nothing
configured the app still works on its saved builds and Live says that no model is connected.

| To run with                                | Set                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the SSI LiteLLM gateway                    | `LITELLM_BASE_URL` (with `/v1`), `LITELLM_API_KEY`, `LITELLM_MODEL`; optional `LITELLM_MODEL_FAST`, `LLM_GATEWAY_RPM` (default 55, the gateway allows 60) |
| OpenAI, or any service that speaks its API | `OPENAI_API_KEY`, `OPENAI_MODEL`; optional `OPENAI_MODEL_FAST`, `OPENAI_BASE_URL`                                                                         |
| Anthropic                                  | `ANTHROPIC_API_KEY`; optional `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `ANTHROPIC_MODEL_FAST`, `ANTHROPIC_BASE_URL`                               |
| the Claude Code command                    | `LLM_PROVIDER=claude-cli`; optional `CLAUDE_CLI_MODEL` (default `sonnet`), `CLAUDE_CLI_MODEL_FAST`. Local testing only: refused when `VERCEL` is set      |
| the stand-in                               | `LLM_PROVIDER=mock`. No key, no network. Answers Turnkey's own agent prompts with valid saved answers, so a whole Live build runs                         |

Keys live in `.env.local` and in Vercel's settings. They are never logged, never sent to the browser, and never in
a `NEXT_PUBLIC_` variable. Error messages sent to the browser carry no address and no key.

`GET /api/health` says which provider and models are in use. `?probe=1` makes one tiny call to check the key and the
model name. `?probe=tools` checks that the model can call tools and whether they go natively or by the JSON protocol.

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

No network. Providers are tested with recorded streams; the Claude command with a fake executable. The mock's saved
answers are checked by running a whole build through the workspace's own checks (`tests/unit/mock-roles.test.ts`).
