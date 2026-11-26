---
paths:
  - "tests/**"
---

# Tests

- `tests/unit` is vitest. Fast, no network, no real keys. Use the mock provider and recorded fixtures. Made-up or public data only.
- `tests/e2e/flows.cjs` holds the browser checks, grouped in eight flows. They drive the real page and read state through `window.__formwork`. A check is one `check('what must be true', condition, detail)` line.
- Add a check next to the ones for the same feature. Do not weaken existing checks: they are the proof that the workspace behaves as before.
- A flaky check is a bug. Wait for a condition, not for a number of milliseconds.
- Run flows through `scripts/heavy.sh`, with your own `PORT`.
