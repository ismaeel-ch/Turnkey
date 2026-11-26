---
paths:
  - "src/legacy/**"
---

# The workspace modules

- These 26 files are the prototype's source, kept byte for byte. `scripts/build-legacy.mjs` concatenates them in a fixed order into one function scope, so they share variables and have no imports or exports.
- Do not reformat, rename, reorder or "modernise" them. Prettier and ESLint skip this folder on purpose.
- Only the integration agent and the supervisor change these files, and only to add a small seam. Everyone else builds in `src/platform` and plugs in through the seams listed in `docs/PLAN.md` section 6.
- A change here needs the browser flows that cover it: `scripts/heavy.sh npm run test:e2e -- <flow>`. All eight flows run in CI.
- Markup is written with the `html` tag from `src/platform/compat/html.ts`. It accepts HTML attribute names (`class`, `for`), style strings, and `onChange` as the native change event. Follow the style of the code around you.
- Reading these files is encouraged: they are the specification of how the product behaves.
