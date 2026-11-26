---
name: release
description: Cut a release when a milestone is complete: verify, tag, publish release notes, close the milestone. Supervisor only.
argument-hint: "[version, for example v0.2.0]"
disable-model-invocation: true
---

Release $ARGUMENTS. Releases are cut only when a milestone is complete, never on a schedule.

1. Every issue in the milestone is closed, or moved to the next milestone with a reason.
2. `main` is green: `gh api repos/{owner}/{repo}/commits/main/check-runs --jq '.check_runs[] | "\(.name): \(.conclusion)"'`.
3. The live URL serves the same commit: `/api/health` reports `commit` equal to `git rev-parse --short origin/main`.
4. Run the `hackathon-check` skill. No open FAIL.
5. Open a pull request that sets `"version"` in `package.json` and adds the section for this version to `CHANGELOG.md`. Merge it when CI is green.
6. Publish: `gh api repos/{owner}/{repo}/releases -f tag_name='$ARGUMENTS' -f target_commitish='main' -f name='$ARGUMENTS' -F generate_release_notes=true`. This creates the tag.
7. Close the milestone: `gh api -X PATCH repos/{owner}/{repo}/milestones/<number> -f state=closed`.
8. Comment on the Mission control issue: the version, what it contains, the live URL, what comes next.
