# Visual regression tests

`tests/e2e/visual.cjs` takes screenshots of the main screens and compares them with the images saved in
`tests/e2e/visual/`. It runs in CI as the `visual` browser flow, next to the others, in about 25 seconds after the build.

## What it covers

Light and dark, at desktop size (1280 × 800) and phone size (390 × 844):

- desktop: onboarding, home, a built clinic app's Build view (the list of steps, then the workflow canvas behind
  "Show how it was built"), the app's Overview, its second page and its Schedule list (view tabs, Filter, Copy CSV), the Data
  view, and the share dialog
- phone: onboarding, home, the builder, the app full screen, and its Schedule list

## How it keeps screenshots stable

- The clock is frozen at 27 Nov 2026, 09:00 in Karachi, and `Math.random` is seeded, so dates and sample data repeat.
- Animations, transitions, the text caret, smooth scrolling, scrollbars and toasts are switched off.
- Every screen waits for fonts, moves the mouse away and drops focus before the shot.
- Nothing outside the app's own origin loads.
- A screen fails only when more than 0.2% of its pixels change by more than pixelmatch's colour threshold (0.1), so
  anti-aliasing noise passes and a moved button does not.

Baselines must be taken on CI's browser and fonts (Ubuntu, Playwright's Chromium). Images taken on another machine
can differ in font rendering and fail in CI.

## When it fails

CI keeps the images as the artifact `shots-visual`: for each screen that changed, `<name>.png` is what CI saw and
`<name>.diff.png` marks the changed pixels in red. If the change is a bug, fix it. If the change is intended, update the
baselines.

## Updating the baselines

1. Push your branch.
2. Run the **Update visual baselines** workflow from the Actions tab with your branch name, or:
   `gh api -X POST repos/ismaeel-ch/Turnkey/actions/workflows/visual-baselines.yml/dispatches -f ref=main -f 'inputs[branch]=<your branch>'`
3. It takes the screenshots on CI's machine and commits them to your branch as "Update visual baselines". Look at
   the new images in that commit.
4. Remove and re-add the `ready-to-merge` label so CI runs again (a commit from the workflow does not start CI).

A new screen with no baseline passes with a note, and its image is in the `shots-visual` artifact; the same workflow
adds it.

To try it locally against a running build: `TK_URL=http://localhost:3000 node tests/e2e/visual.cjs`. Expect font
differences unless your machine matches CI. `VISUAL_UPDATE=1` writes local baselines, but do not commit those.
