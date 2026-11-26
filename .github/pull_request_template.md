## What changed

<!-- One short paragraph. Which files, and what they do now. -->

## Why

<!-- The reason, in a sentence or two. -->

## Issue

Closes #

## How it was verified

<!-- One line per acceptance item of the issue: the item, then how you checked it (a test, a command, a screen). -->
<!-- Say plainly anything you could not verify. -->

## Definition of done (docs/PLAN.md, section 4)

- [ ] The issue's acceptance list is met, and the lines above say how each item was verified.
- [ ] `npm run check` passes locally. CI is green on this pull request, including the browser flows.
- [ ] New code has tests. No file outside the package's "Owns" list changed, except additions to `package.json`.
- [ ] With no model configured the app still works. With `LLM_PROVIDER=mock` the new server path works.
- [ ] No secret, no client or internal data, no `NEXT_PUBLIC_` variable.
- [ ] The title is `WP-nn: what changed`. The pull request names its issue (`Closes #n`). It will be squash-merged and its branch deleted.
