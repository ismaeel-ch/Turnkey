---
name: e2e
description: Run one or more of the browser test flows against a production build and explain any failures. Use when a change might affect the workspace UI, or when CI reports a failing flow.
argument-hint: "[demo|live|misc|views|quests|new|custom|round6]"
---

Run the browser checks for: $ARGUMENTS (all eight flows if empty).

1. `scripts/heavy.sh npm run build`
2. `PORT=<your port> scripts/heavy.sh npm run test:e2e -- $ARGUMENTS`
3. Each line is `PASS name` or `FAIL name → detail`. The run ends with a count and an `ERRORS` list of console and page errors.
4. For each failure, find the check by its name in `tests/e2e/flows.cjs` and read what it compares. Then decide:
   - the page really behaves differently: fix the code (the compat layer in `src/platform/compat` if it is a React difference);
   - the page is right but slower than the check expects: make the check wait for the condition;
   - never change `src/legacy` to make a check pass.
5. Screenshots are in `tests/e2e/shots`. Open the one named in the flow near the failing check.
6. Run the flow again until it passes twice in a row.

What the flows cover: `demo` first run, tour, building the clinic app, changes from chat, reload. `live` a build with a stand-in model. `misc` dark mode, storage blocked, offline. `views` all view types and the dashboard. `quests` the three quest apps and their agent teams. `new` canvas, generated tests, share links, the guide, phones. `custom` workflow steps, approvals, own agents. `round6` the Tester, rooms, releases, install.
