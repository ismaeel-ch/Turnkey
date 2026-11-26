# ADR 6: Any model key

Status: accepted. Implementation: Built. Five providers: LiteLLM, OpenAI-compatible, Anthropic, the Claude Code CLI (development only) and the mock.

## Context

The hackathon requires access through a LiteLLM gateway and a personal key, and the budget is small and shared with judging. Contributors and CI have no key.

## Decision

`src/server/llm` hides the provider behind one interface (`types.ts`). LiteLLM is the default because the rules require it (`LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`, optional `LITELLM_MODEL_FAST`). OpenAI-compatible services work with `OPENAI_*` names, Anthropic with `ANTHROPIC_*`. The Claude Code CLI (`LLM_PROVIDER=claude-code`) is for a developer's machine and is refused in production. `LLM_PROVIDER=mock` needs no key and makes the whole server path testable in CI. Two tiers: `default` (careful, Sonnet) and `quick` (cheaper, Haiku). No `temperature` is sent.

## Consequences

- The app never needs a specific vendor, and a newcomer can run it with no key.
- Keys are read only in server code. The browser sends a prompt and a tier, never a key.
- Guard rails (`src/server/guard/limits.ts`) cap calls per visitor, per minute and per day, so the budget is protected. They live in memory, so they are a brake, not an exact meter; the gateway's own budget is the hard stop.
- A 429 or 5xx is retried with backoff, at most three tries, and a pacer keeps one instance under the gateway's 60 requests a minute (`src/server/llm/http.ts`).

Where to look: `src/server/llm/`, `src/server/guard/limits.ts`, `.env.example`.
