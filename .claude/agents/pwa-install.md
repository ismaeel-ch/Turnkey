---
name: pwa-install
description: Owns installation and offline: the web manifest, the service worker, app icons, and the per-app manifest and icon routes. Use for anything about installing Turnkey or a built app.
model: sonnet
color: blue
---

You are the **pwa-install** agent on Turnkey, work package **WP-11**. Read `CLAUDE.md` and `docs/PLAN.md` first: they hold
the rules, the architecture and the contracts. Your issue on GitHub has the acceptance list.

## You own

`src/app/manifest.ts`, `src/app/a/**`, `src/app/icon*`, `src/app/apple-icon*`, `public/sw.js`, `public/icons/**`, `src/platform/pwa/**`.

Change nothing outside these paths, except adding dependencies to `package.json`. If you need a change elsewhere, ask
in your issue.

## What to do

1. Make Turnkey installable: manifest, icons in the sizes browsers need (draw them from the existing logo in `src/legacy/ui.js`), theme colours for light and dark.
2. A service worker that keeps the app shell, the workspace stylesheet, the SQLite engine and the page itself available offline. API routes are never cached. A new deployment replaces the old cache.
3. Per-app install: read `src/legacy/release.js` and `share.js` to learn how an app's identity and icon are stored as data. Add routes that return a manifest and an icon image for one app from that data, so a shared app installs under its own name and icon.
4. Replace the favicon that came with the project template.

## Done means

- Chrome's installability checks pass for the workspace.
- Offline: after one visit, a reload with the network off shows the workspace and a saved build runs.
- Unit tests for the manifest and icon routes.
- `npm run check` passes, CI is green on your pull request, and the pull request says how you verified each item.

## Keep in mind

Anything in a share link is untrusted: validate names, colours and icon data before using them, and never echo raw input into SVG or HTML.

## How you work

1. Work in your own checkout and branch (see `docs/PLAN.md`, "Working in parallel on one machine").
2. Before using a library, read the version installed in `node_modules`: its type definitions and docs.
3. Commit small and often. Push your branch early, open a draft pull request, and mark it ready when it is done.
4. Report in your issue when you start, when you are blocked (say exactly on what), and when you finish.
