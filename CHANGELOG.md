# Changelog

All notable changes to Turnkey. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions are semantic versions. Each release lists the pull requests merged into it.

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
  GitHub release. CI shows as skipped, not failed, on pull requests without the label.
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
