# Deploying Turnkey

## How deploys happen

- Production deploys only through `.github/workflows/release.yml`, which runs when a release is made. It checks that
  the commit is on `main`, runs `npm run check` on it, builds it with the Vercel CLI and deploys that exact build to
  production. Then it calls `/api/health` on the production address.
- After the deploy, the **smoke test the live site** job runs `tests/e2e/smoke.cjs` on the production address. It
  checks that `/api/health` reports the version just released, that the page has its security headers and the web
  manifest is served, that the page loads and the workspace opens with no uncaught error, that a sample app builds
  with every generated test passing, that Share makes a short link (named `release-check`) that opens the app in a fresh browser, and
  that the first-run screen says "Model connected" (or "No model connected" when there is none). When a model is
  configured it also runs one Live build of the clinic sample from its sentence (about ten model calls) and one tool
  call through `/api/health?probe=1`. That is all the model spend of a release; everything else uses saved builds in
  Demo mode. With no model configured, the model check is a warning, not a failure. The job does not hold back the tag and release: the build is already live, so a failure
  shows as a red run with a table in its summary. To roll back, run the workflow by hand with the previous tag. To run
  the same checks between releases, run the **Live site check** workflow from the Actions tab, or
  `TK_URL=https://turnkey-bay.vercel.app node tests/e2e/smoke.cjs` from a machine that can reach the site.
- `vercel.json` fixes the framework (`nextjs`) and the install, build and output settings, so the build does not
  depend on the Vercel project's own settings. The workflow stops before deploying if the build has no server
  routes.
- Nothing else deploys. `vercel.json` sets `git.deploymentEnabled` to `false`, so Vercel's Git integration does not
  deploy merges, pushes or pull requests. The repository can stay connected to Vercel; it just never starts a build.

## Cutting a release

The usual way, and the one agents use, is a version bump:

1. Merge everything the release needs into `main` through pull requests (CI runs on them, see workflow.md).
2. Open a pull request titled `Release v0.2.0` that changes only `"version"` in `package.json` to `0.2.0` and adds
   the `0.2.0` section to `CHANGELOG.md`. Label it `ready-to-merge` and merge it when CI is green.
3. The merge changes `package.json` on `main`, which starts **Release and deploy**. Because the tag `v0.2.0` does not
   exist yet, it checks and deploys that commit, then creates the tag `v0.2.0` and the GitHub release with notes
   generated from the merged pull requests. If the deploy fails, no tag or release is created; fix it and merge again.

Other changes to `package.json` (a new dependency, say) also start the workflow, but it sees that the tag for the
current version already exists and stops within seconds.

The owner can also publish a release on the website (**Releases**, **Draft a new release**, a new tag on `main`,
**Publish release**). That deploys too, pre-releases included. Keep `package.json`'s version in step afterwards.

## Redeploy or roll back

On the **Actions** tab open **Release and deploy**, choose **Run workflow**, and enter an existing tag. That tag's
commit is checked, built and deployed to production again. Use an older tag to roll back.

## One-time setup (owner)

The workflow needs three repository secrets under **Settings**, **Secrets and variables**, **Actions**:

| Secret              | Where to find it                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `VERCEL_TOKEN`      | vercel.com, **Account Settings**, **Tokens**, **Create**. Scope it to your team or account.  |
| `VERCEL_ORG_ID`     | the project's **Settings**, **General**: the Team ID (for a personal account, your User ID). |
| `VERCEL_PROJECT_ID` | the project's **Settings**, **General**: Project ID.                                         |

Running `npx vercel link` in a checkout writes the two IDs to `.vercel/project.json` too (that folder is ignored).

The model settings (`LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`) stay in Vercel's environment variables
for **Production**. The workflow pulls them into the build with `vercel pull`; they are never stored in GitHub or
printed. After changing them, redeploy the current tag as above.

The health check after a deploy calls the production address Vercel gives the deployment (its shortest alias, read
from the Vercel API). To use a custom domain instead, set the repository variable `PRODUCTION_URL` to it, for example
`https://turnkey.example.com`.

## Seeing the deployment for a release

The run's summary and the **production** environment on the repository's main page link the live site. The Vercel
project's **Deployments** page lists each deployment with the commit it built.

## After a deploy

1. Open the live URL and the health route: `/api/health` answers whether the server is up and whether a model is
   configured. `/api/health?probe=1` also sends one small real call to the model gateway, so use it after changing
   a key or the model name. It costs a little of the budget.
2. Confirm the app shows Live as not connected when no model is set. That is correct behaviour, not a fault.
