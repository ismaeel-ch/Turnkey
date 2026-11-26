---
paths:
  - "src/workspace/**"
---

# The workspace

- `src/workspace` is ordinary TypeScript and JSX: one file per module of the former prototype, ES imports and exports, no shared global scope.
- Every file type-checks under the project's strict settings and passes the same lint rules as the rest of `src`. Do not add `// @ts-nocheck`, a lint exemption, or a new `any` without a comment saying why.
- Improve the code module by module: type it, split large components into smaller ones, and move the mutable store into an external store with explicit actions. Keep each step small enough to review.
- Keep behaviour unchanged unless the change is the point of the pull request. The browser flows in `tests/e2e/flows.cjs` describe the behaviour; a change must keep them green.
- A change here needs the browser flows that cover it: `scripts/heavy.sh npm run test:e2e -- <flow>`. All eight flows run in CI.
- Shared browser helpers (rendering, the sql.js loader, the model client) live in `src/platform`. Reach the server only through `/api` routes, never by importing `src/server`.
- Format with Prettier (`npm run format`). Run `npm run lint` and `npm run typecheck` before you push.
- Reading these files is encouraged: they are the specification of how the product behaves.
