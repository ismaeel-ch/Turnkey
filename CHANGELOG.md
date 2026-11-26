# Changelog

All notable changes to Turnkey. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions are semantic versions. Each release lists the pull requests merged into it.

## [Unreleased]

Merged after v0.3.2; goes out with the next release.

### Added

- Each table, field and screen shows which agent made or last changed it. ([#114](https://github.com/ismaeel-ch/Turnkey/pull/114))
- Editing the workflow of a built app re-runs only the stations it touches, after a short pause; a re-run that would
  rebuild the database asks first. ([#109](https://github.com/ismaeel-ch/Turnkey/pull/109))

### Changed

- A daily dollar cap on model calls, priced from each call's tokens; an empty model answer counts as an upstream
  error. ([#110](https://github.com/ismaeel-ch/Turnkey/pull/110))
- Daily limits on short-link saves. ([#113](https://github.com/ismaeel-ch/Turnkey/pull/113))
- Stricter lint rules for typed code, and store actions in the workspace shell. ([#108](https://github.com/ismaeel-ch/Turnkey/pull/108)) ([#112](https://github.com/ismaeel-ch/Turnkey/pull/112))
- README, architecture, decision records, criteria evidence and the submission text match what is built.

## [0.3.2] - 2026-11-26

Short links work with Vercel's new Blob connection, the agent route has more guard rails, and each release is
smoke-tested on the live site.

### Fixed

- Short links turn on with Vercel's new Blob connection (`BLOB_STORE_ID`, signed in with the deployment's token).
  ([#101](https://github.com/ismaeel-ch/Turnkey/pull/101))
- The workspace no longer crashes on load in development. ([#99](https://github.com/ismaeel-ch/Turnkey/pull/99))

### Changed

- The agent route applies the prompt policy, refuses cross-site calls and caps run bodies. ([#79](https://github.com/ismaeel-ch/Turnkey/pull/79))
- Each release is smoke-tested on the live site after it deploys. ([#92](https://github.com/ismaeel-ch/Turnkey/pull/92))
- The judges' first run is smoother, and a demo video script is added. ([#88](https://github.com/ismaeel-ch/Turnkey/pull/88))
- Dead exports, files and two unused dependencies are removed, with knip to find more. ([#90](https://github.com/ismaeel-ch/Turnkey/pull/90)) ([#100](https://github.com/ismaeel-ch/Turnkey/pull/100)) ([#102](https://github.com/ismaeel-ch/Turnkey/pull/102))
- More types in tests and share, with fewer casts. ([#95](https://github.com/ismaeel-ch/Turnkey/pull/95))

### Added

- Two new saved builds: a grant review desk with its own agent team, and purchase requests. ([#107](https://github.com/ismaeel-ch/Turnkey/pull/107))
- Phone and tablet layouts are polished, with a browser flow for screen sizes. ([#105](https://github.com/ismaeel-ch/Turnkey/pull/105))
- The workspace shell (shell-a, shell-b, shell-c) is typed. ([#80](https://github.com/ismaeel-ch/Turnkey/pull/80))

### Tests

- Short links against a fake Blob service; model gateway edge paths, team runner stops and routes with no model.
  ([#97](https://github.com/ismaeel-ch/Turnkey/pull/97)) ([#103](https://github.com/ismaeel-ch/Turnkey/pull/103))

## [0.3.1] - 2026-11-26

Picks up the production settings for the Claude API key and the short-link store, with typing and Fluent UI work.

### Changed

- More workspace modules are typed: the engine, the app definition, view specs, changes, UI, tester, activity and
  guide. ([#70](https://github.com/ismaeel-ch/Turnkey/pull/70)) ([#74](https://github.com/ismaeel-ch/Turnkey/pull/74)) ([#75](https://github.com/ismaeel-ch/Turnkey/pull/75)) ([#76](https://github.com/ismaeel-ch/Turnkey/pull/76))
- More of the workspace uses Fluent UI inputs, selects, text areas, chips and cards. ([#71](https://github.com/ismaeel-ch/Turnkey/pull/71)) ([#72](https://github.com/ismaeel-ch/Turnkey/pull/72))
- The deploy log lists the names of the production settings Vercel provides. ([#73](https://github.com/ismaeel-ch/Turnkey/pull/73))

## [0.3.0] - 2026-11-26

Live builds run on the server through the agent workflow, the workspace moves to Fluent UI, and shared apps get
short links.

### Added

- Each agent's steps are shown in an activity panel, with a "How it works" page. ([#58](https://github.com/ismaeel-ch/Turnkey/pull/58))
- Live builds run on the server step agent over AG-UI, and every build goes through the workflow graph.
  ([#60](https://github.com/ismaeel-ch/Turnkey/pull/60)) ([#48](https://github.com/ismaeel-ch/Turnkey/pull/48))
- An app's agent team runs as a LangGraph run on the server, and runs in Live. ([#35](https://github.com/ismaeel-ch/Turnkey/pull/35)) ([#52](https://github.com/ismaeel-ch/Turnkey/pull/52))
- Short links for shared apps. ([#63](https://github.com/ismaeel-ch/Turnkey/pull/63))
- The workspace is stored in IndexedDB, with .sqlite export and import, backup and restore. ([#53](https://github.com/ismaeel-ch/Turnkey/pull/53))

### Changed

- The workspace UI is built on Fluent UI React v9, including tabs, switches, message bars and menus. ([#44](https://github.com/ismaeel-ch/Turnkey/pull/44)) ([#62](https://github.com/ismaeel-ch/Turnkey/pull/62))
- A Claude API key is the deployed model backend. ([#66](https://github.com/ismaeel-ch/Turnkey/pull/66))
- The workspace data modules are typed, with a store hook. ([#56](https://github.com/ismaeel-ch/Turnkey/pull/56))

### Tests

- Unit tests and coverage for the foundation code, and a fix for the model-client tests. ([#22](https://github.com/ismaeel-ch/Turnkey/pull/22)) ([#64](https://github.com/ismaeel-ch/Turnkey/pull/64))

## [0.2.0] - 2026-11-26

The first release deployed by the release workflow. The `v0.1.0` tag was published as a pre-release and never
deployed, so this release also carries the changes merged just before it.

### Changed

- The workspace is real React modules; the legacy layer that ran the prototype's plain scripts is gone.
  ([#42](https://github.com/ismaeel-ch/Turnkey/pull/42))
- The model gateway accepts any OpenAI-compatible key and can use the Claude Code CLI for local runs.
  ([#41](https://github.com/ismaeel-ch/Turnkey/pull/41))
- CI runs only on pull requests labelled `ready-to-merge`; production deploys only on a release; Dependabot is off.
  ([#40](https://github.com/ismaeel-ch/Turnkey/pull/40))
- A release is made by merging a version bump in `package.json`, which deploys and then creates the tag and the
  GitHub release. CI shows as skipped, not failed, on pull requests without the label
  and on runs replaced by a newer one.
  ([#43](https://github.com/ismaeel-ch/Turnkey/pull/43))

## [0.1.0] - 2026-11-26

The React foundation: the prototype's workspace runs unchanged inside the Next.js app, with a model route and CI.

### Added

- The prototype's workspace modules run in Next.js 16 and React 19 through a compatibility layer, with all 286
  browser checks passing against the React app. ([#20](https://github.com/ismaeel-ch/Turnkey/pull/20))
- A model route (`POST /api/llm`) and a health route, so Live mode works once a key is set on Vercel.
  ([#20](https://github.com/ismaeel-ch/Turnkey/pull/20))
- Continuous integration: a secrets scan, lint, typecheck, unit tests, a production build, and one browser job per
  flow. ([#20](https://github.com/ismaeel-ch/Turnkey/pull/20))
- Shared dependencies are installed once for parallel work, and a runbook for that work is added.
  ([#21](https://github.com/ismaeel-ch/Turnkey/pull/21))
