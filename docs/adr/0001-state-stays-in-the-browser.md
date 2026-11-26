# ADR 1: State and SQLite stay in the browser

Status: accepted. Implementation: Built.

## Context

Turnkey's apps are small record-keeping apps. Each one is a definition (tables, rules, views, screens) plus a SQLite database. Vercel's free plan keeps nothing between requests, and the owner asked for data that is still there after a reload. The app also has to work with no server state and be easy to run for a public demo with no login.

## Decision

State and data live in the browser. The workspace keeps app definitions, settings and releases in browser storage (keys `formwork:v1:state` and `formwork:v1:db:<appId>`, `src/workspace/core.ts`; the `formwork:` prefix is the product's earlier name, kept so saved data stays readable). Each app's database is SQLite compiled to WebAssembly (sql.js, served from `/vendor`), saved into browser storage after changes. The server is stateless: it relays model calls and enforces limits.

## Consequences

- A reload, a sign-out and a return all keep the data, with no account and no database to pay for.
- Every visitor has their own private workspace, which suits a public demo.
- Data does not follow the owner to another device or browser, and browser storage has a size limit (the app says when it is full).
- Built apps are single-user prototypes. Real multi-user use needs a server-side store, which is not built.
- The workspace and each app's database are kept in IndexedDB (`src/platform/storage`), with the earlier localStorage format still readable, export and import of an app's `.sqlite` file, and backup and restore of the whole workspace (WP-10).
- One exception, by choice of the person sharing: a shared app saved under a short link is stored in Vercel Blob (`src/server/share`), with a daily limit on saves. Without a store, sharing falls back to the long link that carries the app itself.

Where to look: `src/workspace/core.ts`, `src/workspace/db.ts`, `docs/PLAN.md` section 2, decision 1.
