---
name: add-connector
description: Add a new public data source that agents can call as a tool. Use when an app's agents need a source that is not in src/server/connectors yet.
argument-hint: "[source name]"
---

Add the connector `$ARGUMENTS`.

1. Confirm the source is public, free, needs no login from the visitor, and allows this use. Note its terms in `THIRD_PARTY_NOTICES.md`.
2. Create `src/server/connectors/$ARGUMENTS.ts` with the same shape as the others: `search(query, options)` returning `{ ok: true, items: [{ title, url, text, source }] }` or `{ ok: false, code, message }`.
3. Validate the response with zod. Time out after 8 seconds. Trim text to what an agent needs. Cache identical requests for 10 minutes.
4. Export a tool description: name, one sentence on what it is for, and the input schema.
5. Register it in `src/server/connectors/index.ts`. The route `/api/connectors/[name]` picks it up from there.
6. Record one real response as `tests/unit/fixtures/connectors/$ARGUMENTS.json` and test against the fixture. No network in tests.
7. If it needs a key, read it from `process.env` in the connector, add the name to `.env.example` and to the table in `docs/PLAN.md`, and return a clean `not_configured` when it is missing.
