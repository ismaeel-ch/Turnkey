# Runbook for agents working on Turnkey in parallel

You are one of several agents building this repository at the same time, each in its own checkout, each on its own
work package. Nobody is watching live. You cannot ask questions: decide, write the decision down in your pull
request, and move on. `CLAUDE.md` has the rules, `docs/PLAN.md` the architecture and who owns what.

## Start

1. Your checkout, branch, port and issue number are in the message that started you. Work only inside your checkout.
   Never touch another agent's checkout or `/home/claude/turnkey`.
2. Read `CLAUDE.md`, `docs/PLAN.md`, your role file in `.claude/agents/`, and your issue:
   `gh api repos/ismaeel-ch/Turnkey/issues/<n> --jq .body`
3. `node_modules` is already in your checkout. Comment on your issue that you have started (one line).

## GitHub from here

Only GitHub's REST API works in this environment. `gh pr create`, `gh pr view`, `gh issue comment` and anything
else that uses GraphQL will fail. Use `gh api`:

| To                                  | Command                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| comment on an issue or pull request | `gh api repos/ismaeel-ch/Turnkey/issues/<n>/comments -f body='…'`                                                        |
| open a draft pull request           | `gh api repos/ismaeel-ch/Turnkey/pulls -f title='WP-nn: …' -f head='<branch>' -f base='main' -f body='…' -F draft=true`  |
| mark it ready                       | `gh api -X POST repos/ismaeel-ch/Turnkey/pulls/<n>/ccr/ready_for_review`                                                 |
| update its title or body            | `gh api -X PATCH repos/ismaeel-ch/Turnkey/pulls/<n> -f body='…'`                                                         |
| see CI for a commit                 | `gh api repos/ismaeel-ch/Turnkey/commits/<sha>/check-runs --jq '.check_runs[] \| "\(.name): \(.conclusion // .status)"'` |
| list open pull requests             | `gh api 'repos/ismaeel-ch/Turnkey/pulls?state=open' --jq '.[] \| "\(.number) \(.head.ref) \(.title)"'`                   |
| read another pull request's files   | `gh api repos/ismaeel-ch/Turnkey/pulls/<n>/files --jq '.[].filename'`                                                    |

CI logs cannot be read through this API. If a job fails, run the same step locally: the job names match the npm
scripts (`check:secrets`, `lint`, `typecheck`, `test`, `build`, `test:e2e -- <flow>`).

Do not write `@name` mentions in issues or pull requests.

## Git

- Push with `git -c push.negotiate=true push -u origin <branch>`. The remote takes two transfers at a time: if a
  push or fetch is refused (429, or the connection drops), wait 15 seconds and try again, up to five times.
- Never push to `main`. Never force push. The hooks in `.claude/hooks` block both.
- `main` moves while you work. Before you open your pull request, and whenever it conflicts:
  `git fetch origin main && git merge origin/main`. Resolve conflicts only in files you own. If the conflict is in
  `package-lock.json`, take `origin/main`'s version and run `npm install` again.
- Commit messages: imperative subject under 72 characters, a body that says why. End with the attribution trailer
  lines your environment tells you to use. If it gives none, end with:

  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SPhXm6pR9pLfNvDmebxTpW
  ```

- Pull request bodies end with these two lines:

  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01SPhXm6pR9pLfNvDmebxTpW
  ```

## This machine is shared

Two cores and seven gigabytes of memory serve every agent. So:

- Wrap anything heavy in `scripts/heavy.sh`, which runs one heavy command at a time across all checkouts:
  `scripts/heavy.sh npm run check`, `scripts/heavy.sh npm run build`, `scripts/heavy.sh npm run test:e2e -- demo`.
  Running a single test file while you work is fine without it: `npx vitest run tests/unit/<file>`.
- Only react-port, integration and the supervisor run browser flows locally. Everyone else lets CI run them.
- Anything that starts a server uses your own port: `PORT=<your port>`.
- Do not leave servers or watchers running. Kill what you start.

## Flow of one work package

1. Start with the piece other agents depend on (an interface, a contract) and post it as a comment on your issue.
2. Push early. Open a draft pull request after your first meaningful commit, titled `WP-nn: what it does`, with
   `Closes #<issue>` in the body. Keep pushing small commits.
3. Check what others have posted before relying on a guess: the comments on their issues, the files in their
   draft pull requests.
4. Before marking it ready: `scripts/heavy.sh npm run check` passes, CI is green on your last commit, and the body
   says what changed, why, and how each acceptance item was verified. Say plainly what you could not verify.
5. Mark it ready and comment on your issue: what is delivered, what is left, anything the supervisor must know.
6. The supervisor merges. Do not merge your own pull request. If the supervisor asks for changes in a comment,
   make them.
7. If time remains, take the next most valuable thing in your package and open a second small pull request.

## If you are stuck

- A dependency on another package is not ready: code against a small interface of your own, inside your folders,
  and say in your pull request what has to be joined later.
- Something outside your folders must change: describe the change in a comment on your issue. Do not make it.
- A check fails for a reason that is not yours: say so in a comment on the Mission control issue (#18), with the
  evidence, and continue with what you can.
- Never weaken a test, a limit or a rule to get past it.
