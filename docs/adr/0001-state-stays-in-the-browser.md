# ADR 1: State and SQLite stay in the browser

Status: accepted. Implementation: Built.

## Context

Turnkey's apps are small record-keeping apps. Each one is a definition (tables, rules, views, screens) plus a SQLite database. Vercel's free plan keeps nothing between requests, and the owner asked for data that is still there after a reload. The app also has to work with no server state and be easy to run for a public demo with no login.

## Decision

State and data live in the browser. The workspace keeps app definitions, settings and releases in browser storage (keys `formwork:v1:state` and `formwork:v1:db:<appId>`, `src/legacy/core.js`). Each app's database is SQLite compiled to WebAssembly (sql.js, served from `/vendor`), saved into browser storage after changes. The server is stateless: it relays model calls and enforces limits.

## Consequences

- A reload, a sign-out and a return all keep the data, with no account and no database to pay for.
- Every visitor has their own private workspace, which suits a public demo.
- Data does not follow the owner to another device or browser, and browser storage has a size limit (the app says when it is full).
- Built apps are single-user prototypes. Real multi-user use needs a server-side store, which is not built.
- Planned: a storage adapter with IndexedDB, keeping the current format readable, and export and import of an app's SQLite file (WP-10).

Where to look: `src/legacy/core.js`, `src/legacy/db.js`, `docs/PLAN.md` section 2, decision 1.
