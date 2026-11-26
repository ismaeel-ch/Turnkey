# Security

Turnkey is a public demo with no login. The things worth protecting are the model key and the model budget, which is
small and does not refill. This page says where the key lives, what protects it, and what to do if something goes wrong.

## Where keys live

- **On Vercel**, as environment variables of the project. The deployed site uses `ANTHROPIC_API_KEY` for now; the SSI
  gateway names (`LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`) work the same way and take over when they are
  set and the Anthropic key is not (`src/server/llm/index.ts`, `.env.example`). Short links use `BLOB_STORE_ID` or
  `BLOB_READ_WRITE_TOKEN`. All of them are read only in server code (`src/app/api/**`, `src/server/**`).
- **On a developer's machine**, in `.env.local`, which git ignores. With no key there, the Claude Code command is used.
- **Nowhere else.** Not in code, tests, docs, commit messages, logs, screenshots or pull requests. No variable that
  starts with `NEXT_PUBLIC_` may hold a secret, because Next.js sends those to the browser.

The browser never calls a model provider. It calls Turnkey's own routes (`/api/copilotkit`, `/api/llm`,
`/api/agent/step`, `/api/agent/team`), and the server adds the key. A lint rule (`no-restricted-imports` in
`eslint.config.mjs`) stops browser and shared code from importing `src/server`.

## What protects the key and the budget

| Layer              | What it does                                                                                                                                       | Where                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Prompt policy      | Only the prompts Turnkey's own agents write are relayed, on every model route. Free-form requests are refused, so the routes are not a chat.       | `src/server/guard/prompt.ts`                 |
| Team policy        | An app's agent team comes from the browser, so its names, jobs and hints are checked for text that gives the model orders before any call.         | `src/server/graph/team/policy.ts`            |
| Cross-site refusal | Model and share routes answer only Turnkey's own pages (`Sec-Fetch-Site`, `Origin`), so another site cannot spend the budget through its visitors. | `src/server/guard/http.ts`                   |
| Limits             | Calls per visitor per minute, for everyone per minute, per day; prompt size; answer size.                                                          | `src/server/guard/limits.ts`                 |
| Daily dollar cap   | Model calls stop for the day once their priced cost reaches `LLM_DAILY_SPEND_USD` (default 5). `/api/health` shows what was spent.                 | `src/server/guard/limits.ts`, `llm/usage.ts` |
| Kill switch        | `LIVE_MODE=off` refuses every model call at once. Saved builds keep working.                                                                       | `src/server/guard/limits.ts`                 |
| Short-link quotas  | Saves per visitor, saves and megabytes per day, so the free Blob store cannot be filled.                                                           | `src/server/share/quota.ts`                  |
| Body checks        | Request bodies are size-limited and validated with zod; every refusal is JSON with a `code`.                                                       | `src/server/guard/http.ts`                   |
| Security headers   | Content security policy (own origin only, no outside connections), no framing, no sniffing, HSTS.                                                  | `src/server/guard/headers.ts`                |
| Secrets scan       | Fails `npm run check` and CI if a key-shaped string or an env file is in the repo. `--history` scans every commit.                                 | `scripts/check-secrets.mjs`                  |

The limits are set by environment variables (`LLM_RATE_PER_MINUTE`, `LLM_GLOBAL_PER_MINUTE`, `LLM_DAILY_CALL_CAP`, `LLM_DAILY_SPEND_USD`,
`LLM_MAX_PROMPT_CHARS`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_MAX_ANSWER_CHARS`; `LIGHT_RATE_PER_MINUTE` and `LIGHT_GLOBAL_PER_MINUTE` for the free routes: connectors and health). Counters are kept in memory by each warm server
instance, so they are a brake and not an exact meter. The only hard stop is a spend limit set on the key itself, in the
Claude Console (or the gateway's own budget for a LiteLLM key).

There is deliberately no login or passcode: evaluators must be able to use the app without one.

## If a key leaks

Treat a key as leaked if it was committed, pasted into an issue or pull request, shown in a screenshot, or printed in a
log, even for a minute and even if the commit was removed afterwards.

1. **Switch live calls off.** Set `LIVE_MODE=off` on Vercel and redeploy. The app still runs on saved builds.
2. **Revoke the key** at the gateway or provider and create a new one. This is the step that matters; deleting the
   commit does not make a leaked key safe.
3. **Put the new key on Vercel** (and in your own `.env.local`), remove `LIVE_MODE=off`, redeploy.
4. **Remove it from the repository.** Delete the line, and if it is in history, rewrite history only with the owner's
   agreement. Run `node scripts/check-secrets.mjs --history` to look for other traces.
5. **Check the gateway's usage** for calls you do not recognise and note them.

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this
repository (the Security tab, "Report a vulnerability"). Say what you found, how to reproduce it, and what you think
the impact is. Reports are read by the repository owner.

Out of scope: the public demo being usable without a login, and the limits being reachable by many visitors at once
(that is what the limits are for).
