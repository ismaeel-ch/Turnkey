# ADR 8: The workspace is ordinary code

Status: accepted. Replaces the first version of this decision ("the legacy modules are not rewritten"). Implementation:
Built. Typing is nearly done (4 files left).

## Context

The prototype was 26 plain-script modules (about 900 KB) that held the whole product and were verified by 286 browser
checks. The first decision was to run them unchanged in the Next.js app through a compatibility layer
(`src/platform/compat`) and a build step (`scripts/build-legacy.mjs`), so that nothing broke on day one. That worked:
every check passed on React from the first pull request. But the layer hid the code from the type checker, from lint
and from imports, and the owner asked for legacy code to be removed.

## Decision

The modules became ES modules with JSX in `src/workspace`, one file per former module, loaded by the page as ordinary
code (pull request #42). The compatibility layer and the build step were deleted. Each file is then typed on its own
(remove `// @ts-nocheck` only when that file type-checks), split into components, and its mutable store is moved to
an external store. New behaviour still reaches the outside world through the seams in `docs/PLAN.md` section 6.

## Consequences

- The type checker, lint and the bundler see the whole product. No second build step.
- The browser flows are what protect the behaviour while the code changes: every change keeps the flows that exercise
  it green (`CLAUDE.md` rule 5). There are now 12 browser flows in CI.
- On 26 Nov after v0.3.2, 4 of the 34 files in `src/workspace` still start with `// @ts-nocheck`, down from 26 of 29
  when the move was made; the rest type-check under strict settings.
- Some names (the `formwork:v1:` storage prefix, `window.__formwork`) come from the product's earlier name and are kept
  so saved data stays readable.

Where to look: `CLAUDE.md` rule 5, `docs/PLAN.md` decision 8 and section 6, `src/workspace`.
