---
paths:
  - "src/platform/**"
  - "src/app/**/*.tsx"
---

# Browser code

- Client components start with `'use client'`. The page is static; everything interactive mounts in the browser.
- Never import from `src/server`. The browser reaches the server only through `fetch` to this app's own `/api` routes.
- No key, model name setting or provider address in browser code. No `NEXT_PUBLIC_` variables.
- New features plug into the workspace through the seams in `docs/PLAN.md` section 6, behind a switch that leaves today's behaviour as the default.
- Browser storage can be full or blocked. Wrap reads and writes, and keep working in memory when it fails.
- Anything from a share link or from the model is untrusted: validate it, and never put it into HTML, SVG or SQL as raw text.
- `src/platform/generated` is build output. Never edit it.
