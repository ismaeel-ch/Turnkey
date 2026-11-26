# Deploying Turnkey

## How deploys happen

- Vercel's Git integration deploys the production branch `main` on every merge to it. The repository is imported
  into Vercel; the production branch is `main`.
- No other branch deploys. `vercel.json` sets `git.deploymentEnabled` to `true` for `main` and to `false` for `**`
  (every other branch). Vercel's rule: a branch that matches several rules deploys if one of them is `true`, so
  `main` deploys and nothing else does.
- The free plan allows 100 deployments a day. Many agents push at once, so only `main` deploys. If a day gets close
  to the limit, the supervisor merges pull requests in batches.

## Seeing the deployment for a commit

GitHub shows the commit status that Vercel reports. From any checkout:

```
gh api repos/ismaeel-ch/Turnkey/commits/<sha>/status --jq '.statuses[] | "\(.context): \(.state) \(.target_url)"'
```

`state` is `pending`, `success` or `failure`. `target_url` opens the deployment in Vercel. The check runs of the same
commit are listed by `gh api repos/ismaeel-ch/Turnkey/commits/<sha>/check-runs`.

If no Vercel status appears for a merge commit, the deployment did not start. Check the Vercel project's Deployments
page for that commit before doing anything else.

## After a deploy

1. Open the live URL and the health route: `/api/health` answers whether the server is up and whether a model is
   configured. `/api/health?probe=1` also sends one small real call to the model gateway, so use it after changing
   a key or the model name. It costs a little of the budget.
2. Confirm the app shows Live as not connected when no model is set. That is correct behaviour, not a fault.

## Fallback: if merges stop deploying

Vercel's free plan may not start deployments for commits whose author is not the account owner (PLAN.md, risks).
Pull requests are squash-merged through GitHub, so the commit on `main` carries the owner's identity, which should
avoid this. If deployments still do not start after a merge:

1. In Vercel, open the project, go to Settings, then Git, then Deploy Hooks. Create a hook named `main` for the
   production branch `main`. Copy the URL once; it is a secret.
2. In GitHub, add it as a repository secret named `VERCEL_DEPLOY_HOOK_URL` (Settings, Secrets and variables, Actions).
3. Add a repository variable named `VERCEL_DEPLOY_HOOK_ENABLED` with the value `true`.
4. `.github/workflows/deploy-hook.yml` now calls the hook on every push to `main`. It does nothing while the variable
   is unset. Turn it off again by deleting the variable once Vercel deploys by itself, or you will get two deployments
   per merge.

Do not print the hook URL in a log, a pull request or an issue. It lets anyone start a deployment.
