# ADR 5: Definitions, not code

Status: accepted. Implementation: Built.

## Context

Agents write the app. If an agent's output were run as code, a wrong or hostile answer (or a hostile share link) could do anything in the visitor's browser.

## Decision

Agents return JSON definitions: tables, columns, a status workflow, access rules, views, screens, a tour, a team. A fixed runtime turns them into SQLite tables, role-guarded endpoints and screens. Every definition is normalised and checked before it is applied (`normBrief`, `normSchema`, `normBackend`, `normViews`, `normUI` in `src/legacy`). A share link carries definitions and rows, and its definition passes every check again when opened (`src/legacy/share.js`).

## Consequences

- Nothing a model writes is executed. The worst a bad answer can do is fail a check and be sent back.
- Agents can only express what the fixed catalogs allow (column types, view types, room layouts, icons). That limits what a build can be.
- New capabilities mean extending the runtime, then the catalog.
- Checks are real: they create the tables, call every endpoint as every role, draw every view and screen, and replay the tour.

Where to look: `src/legacy/line.js`, `engine.js`, `runtime.js`, `share.js`.
