---
paths:
  - "src/server/**"
  - "src/app/api/**"
---

# Server code

- This code runs in Vercel functions. Nothing is kept between requests: no module-level state that correctness depends on, no files written to disk.
- A request may run 5 minutes at most. One agent step per request. Set `export const maxDuration` on every route that calls a model.
- Keys are read from `process.env` in `src/server/llm` and nowhere else. Never log a key, a full prompt or a full model answer. Never return a gateway address or a key fragment to the browser.
- Validate every request body, every model answer and every connector response before using it (zod, or the normalisers the feature already has).
- Errors sent to the browser are JSON with a `code` and a short plain `message`. Codes in use: `not_configured`, `rate_limited`, `budget`, `bad_request`, `upstream`.
- Every route that reaches a model goes through `src/server/guard` first.
- Never import from `src/platform`, `src/legacy` or a client component.
- Route handlers follow the installed Next.js docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- Tests call the route handler function directly with a `Request` and the mock provider. No network in tests.
