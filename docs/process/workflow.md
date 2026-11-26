# Branching, review, merge and release

One page for the whole path from an issue to a release. CLAUDE.md has the rules; docs/PLAN.md section 5 has the
process in brief. This page says what the repository does to enforce it.

## Branches

- One issue, one branch, one purpose. Names: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `test/…`.
- Never push to `main`. Branch protection requires a pull request and the passing check `ci` (see owner-setup.md).
- Open pull requests as drafts while you work. CI does not run on them, which saves Actions minutes.
- Rebase or merge `origin/main` into your branch before you open the pull request, and again whenever it conflicts.
- Never force push a branch that someone else reviews.

## Pull requests

- Title: `WP-nn: what changed`. For a change outside a work package, a short imperative title.
- Body: use the template. It lists the definition of done (docs/PLAN.md section 4) and names the issue with
  `Closes #n`.
- Keep pull requests small. One issue per pull request.

## Checks

`.github/workflows/ci.yml` runs the full checks only when a pull request into `main` is about to be merged: when it
is not a draft and carries the label `ready-to-merge`. Adding the label starts a run, and each later push to the
labelled pull request runs it again. It can also be started by hand from the **Actions** tab. Nothing runs on a push
to `main`. Without the label, only the `ci` job runs, for a few seconds, and fails on purpose with a message saying
to add the label, so an unchecked pull request never looks green.

| Job            | What it runs                                                         |
| -------------- | -------------------------------------------------------------------- |
| `check`        | secrets scan, lint, typecheck, unit tests, production build          |
| `e2e` (9 jobs) | one browser flow each, with failure screenshots kept for 3 days      |
| `ci`           | passes only if the jobs above ran and passed; the one required check |

A run takes about four minutes. A job that fails can be reproduced locally with the matching npm script:
`npm run check:secrets`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e -- <flow>`.
Heavy commands on the shared machine go through `scripts/heavy.sh`.

## Review and merge

- The owner reviews. CODEOWNERS maps every path to the owner, so the owner is asked to review every pull request.
- Merge by squash only. The title of the pull request becomes the commit on `main`, so write it well.
- When the pull request is done, mark it ready and add the label `ready-to-merge`. Auto-merge may be used once `ci`
  is green. Do not merge a pull request that has not been reviewed.
- The head branch is deleted automatically after the merge.
- A merge to `main` does not deploy. Production deploys only when a release is published. See deploy.md.

## Dependency updates

Dependabot is switched off for now (no `.github/dependabot.yml`), so it opens no pull requests and starts no runs.
Update dependencies by hand in their own pull request.

## Release

A release is a version on `main`, tagged `v` and a semantic version (for example `v0.2.0`). Making one is what deploys
to production.

1. Open a pull request `Release v0.2.0` that raises `"version"` in `package.json` and adds the `CHANGELOG.md` section
   listing the merged pull requests. Merge it when CI is green.
2. `.github/workflows/release.yml` runs on that merge. It runs the checks, builds the commit with the Vercel CLI,
   deploys it to production and checks `/api/health`, then creates the tag and the GitHub release with generated
   notes. deploy.md has the details, the secrets it needs, and how to redeploy or roll back.
3. Check the release page lists the expected pull requests and the run's summary shows the live URL.
