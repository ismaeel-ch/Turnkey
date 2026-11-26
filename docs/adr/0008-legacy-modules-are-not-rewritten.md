# ADR 8: The legacy modules are not rewritten

Status: accepted. Implementation: Built.

## Context

The prototype is 26 plain-script modules (about 900 KB) that hold the whole product and were verified by 286 browser checks. A rewrite in the time available would risk the product and every check.

## Decision

Keep `src/legacy` as it is and run it unchanged in the Next.js app. `src/platform/compat` puts React 19 behind the names the modules already use (`html`, `render`, hooks), so the built bundle (`scripts/build-legacy.mjs`) is the prototype's script. New behaviour is added beside it in `src/platform`, reached through a few named seams (`window.claude.use('sample')`, storage keys, `window.__formwork`, `window.__turnkeyOptions`). Only the integration agent and the supervisor change `src/legacy`, with the smallest possible change.

## Consequences

- The whole product, and all 286 checks, ran on the React app from the first pull request.
- New server features must fit the existing seams.
- The legacy code is dense and long-lined. It was not made to be pretty; the checks are what protect it.
- Some names (the `formwork:v1:` storage prefix, `window.__formwork`) come from the product's earlier name and are kept so saved data stays readable.

Where to look: `CLAUDE.md` rule 5, `docs/PLAN.md` section 6, `src/platform/compat`.
