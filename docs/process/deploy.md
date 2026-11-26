# Deploying Turnkey

## How deploys happen

- Production deploys only when a GitHub release is published. `.github/workflows/release.yml` checks that the
  release tag points at a commit on `main`, runs `npm run check` on it, builds it with the Vercel CLI and deploys
  that exact build to production. Then it calls `/api/health` on the production address.
- Nothing else deploys. `vercel.json` sets `git.deploymentEnabled` to `false`, so Vercel's Git integration does not
  deploy merges, pushes or pull requests. The repository can stay connected to Vercel; it just never starts a build.
- Pre-releases and drafts do not deploy. Publishing a release marked as a pre-release is a safe way to tag a commit
  without shipping it.

## Cutting a release

1. Merge everything the release needs into `main` through pull requests (CI runs on them, see workflow.md).
2. Publish the release, either on the website (**Releases**, **Draft a new release**, create the tag such as
   `v0.2.0` on `main`, **Generate release notes**, **Publish release**) or from a checkout:
   `gh release create v0.2.0 --target main --generate-notes`.
3. Watch the **Release and deploy** run on the **Actions** tab. Its summary shows the deployment and the live URL.

A release created by another workflow using `GITHUB_TOKEN` does not start the deploy; GitHub does not chain
workflows that way. Publish it yourself, or with a personal token.

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

If the production address ever changes, set the repository variable `PRODUCTION_URL` (default
`https://ssi-ai-hackathon.vercel.app`) so the health check calls the right place.

## Seeing the deployment for a release

The run's summary and the **production** environment on the repository's main page link the live site. The Vercel
project's **Deployments** page lists each deployment with the commit it built.

## After a deploy

1. Open the live URL and the health route: `/api/health` answers whether the server is up and whether a model is
   configured. `/api/health?probe=1` also sends one small real call to the model gateway, so use it after changing
   a key or the model name. It costs a little of the budget.
2. Confirm the app shows Live as not connected when no model is set. That is correct behaviour, not a fault.
