# Branching, review, merge and release

One page for the whole path from an issue to a release. CLAUDE.md has the rules; docs/PLAN.md section 5 has the
process in brief. This page says what the repository does to enforce it.

## Branches

- One issue, one branch, one purpose. Names: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `test/…`.
- Never push to `main`. Branch protection requires a pull request and the passing check `ci` (see owner-setup.md).
- Rebase or merge `origin/main` into your branch before you open the pull request, and again whenever it conflicts.
- Never force push a branch that someone else reviews.

## Pull requests

- Title: `WP-nn: what changed`. For a change outside a work package, a short imperative title.
- Body: use the template. It lists the definition of done (docs/PLAN.md section 4) and names the issue with
  `Closes #n`.
- Keep pull requests small. One issue per pull request.

## Checks

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`:

| Job            | What it runs                                                           |
| -------------- | ---------------------------------------------------------------------- |
| `check`        | secrets scan, lint, typecheck, unit tests, production build            |
| `e2e` (8 jobs) | one browser flow each, with failure screenshots kept for 3 days        |
| `ci`           | passes only if the three above pass; this is the one required check    |

A run takes about four minutes. A job that fails can be reproduced locally with the matching npm script:
`npm run check:secrets`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e -- <flow>`.
Heavy commands on the shared machine go through `scripts/heavy.sh`.

## Review and merge

- The owner reviews. CODEOWNERS maps every path to the owner, so the owner is asked to review every pull request.
- Merge by squash only. The title of the pull request becomes the commit on `main`, so write it well.
- Auto-merge may be used once `ci` is green. Do not merge a pull request that has not been reviewed.
- The head branch is deleted automatically after the merge.
- A merge to `main` deploys to production through Vercel. See deploy.md.

## Dependency updates

Dependabot opens grouped weekly pull requests for npm (at most 4 open) and GitHub Actions (at most 1). They go
through the same review and checks as any other pull request. Do not merge a dependency update that changes
`package-lock.json` alongside other work; take it on its own.

## Release

A release is a tag on a commit that is already on `main`, named `v` and a semantic version (for example `v0.2.0`),
and it is cut when the milestone in docs/PLAN.md section 3 is complete and `main` is green and deployed.

1. Update `CHANGELOG.md` with the merged pull requests of the milestone, and merge that change through a pull request.
2. Confirm the commit on `main` has a passing `ci` check and a successful deployment (deploy.md).
3. Create and push the annotated tag on that commit: `git tag -a v0.2.0 -m "v0.2.0" <sha>` then
   `git push origin v0.2.0`. Create it from the owner's checkout or from a tag push on the GitHub website.
4. `.github/workflows/release.yml` runs. It stops if the tag is not on `main`. Otherwise it runs the checks and the
   build, then publishes the GitHub release with notes generated from the merged pull requests. If the release
   already exists it does nothing.
5. Check the release page lists the expected pull requests.
