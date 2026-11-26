# ADR 9: CI when a pull request is ready, deploy only on a release

Status: accepted. Implementation: Built.

## Context

Many agents push to many branches at once. Running the full checks (build plus nine browser flows) on every push
used up GitHub Actions minutes, and Vercel's free plan limits deployments per day. Deploying every merge also meant
the live URL could change in the middle of a demo.

## Decision

CI (`.github/workflows/ci.yml`) runs only on a pull request that is out of draft and labelled `ready-to-merge`, or
when started by hand. Nothing runs on a push to `main`. Production deploys only through
`.github/workflows/release.yml`: merging a version bump in `package.json` checks that commit, deploys it with the
Vercel CLI, then creates the tag and the GitHub release. Vercel's Git integration is off (`vercel.json`).

## Consequences

- The live URL changes only when someone decides to release, and each deployment has a tag to roll back to.
- A pull request is checked once, when it is ready, not on every push. Authors run `npm run check` locally before
  each push.
- `main` can hold merged work that is not live yet. `/api/health` names the deployed commit so the two can be compared.

Where to look: `.github/workflows/`, `vercel.json`, [`docs/process/deploy.md`](../process/deploy.md),
[`docs/process/workflow.md`](../process/workflow.md).
