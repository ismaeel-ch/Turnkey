---
name: ship-pr
description: Run the checks, push the current branch and open or update its pull request. Use when a piece of work is ready for review or needs a draft pull request.
argument-hint: "[issue-number]"
disable-model-invocation: true
---

Ship the current branch as a pull request for issue #$ARGUMENTS.

1. Refuse if the branch is `main`.
2. `git fetch origin main` and rebase on `origin/main`. Resolve conflicts in your own files; if a conflict is in a file you do not own, stop and say so in the issue.
3. `npm run check`. Fix what fails. Do not skip a check.
4. Commit anything outstanding. Subject in the imperative, under 72 characters; the body says why.
5. `git push -u origin <branch>`. If the remote answers 429, wait 10 seconds and try again.
6. Open the pull request (or update it if one exists for the branch). In cloud sessions GitHub's GraphQL API is not available, so use REST:
   `gh api repos/{owner}/{repo}/pulls -f title='WP-nn: what changed' -f head='<branch>' -f base='main' -f body='<text>'`
7. The body has four parts: what changed, why, how each acceptance item was verified, and `Closes #<issue>`.
8. Read CI: `gh api repos/{owner}/{repo}/commits/<sha>/check-runs --jq '.check_runs[] | "\(.name): \(.conclusion // .status)"'`. If something fails, read the log, fix, push again.
