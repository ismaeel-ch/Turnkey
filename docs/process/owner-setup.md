# Owner setup: what only the owner can do

Agents cannot change repository settings, read Actions logs or create a Project board from their own access, so these
steps are the owner's. Do them once, in this order. Each one can be checked afterwards.

## 1. Repository merge options

1. Open github.com/ismaeel-ch/Turnkey, then **Settings**, then **General**.
2. Under **Pull Requests**, untick **Allow merge commits** and **Allow rebase merging**. Keep **Allow squash merging**
   ticked, and set its default commit message to **Pull request title**.
3. Tick **Allow auto-merge**.
4. Tick **Automatically delete head branches**.
5. Save each section if the page asks you to.

## 2. Protect `main`

1. In **Settings**, open **Rules**, then **Rulesets**, then **New branch ruleset** (or **Branches**, then
   **Add classic branch protection rule** if rulesets are not offered).
2. Name it `main protection`. Set **Enforcement status** to **Active**.
3. Under **Target branches**, add the default branch `main`.
4. Tick **Require a pull request before merging**. Leave the approval count at 0 or 1; the owner merges.
5. Tick **Require status checks to pass**. Search for **ci** and add it. It is the job name in `ci.yml`; add it only
   after the workflow has run once on a pull request, or GitHub will not find it.
6. Tick **Block force pushes** and **Restrict deletions**.
7. Save.

## 3. Project board that collects the issues

1. Open your profile or the repository, then the **Projects** tab, then **New project**. Choose the board layout.
2. Name it `Turnkey`.
3. In the project, open the menu (the three dots or **...**), then **Workflows**, then **Auto-add to project**.
4. Set the filter to `is:issue repo:ismaeel-ch/Turnkey`, tick the workflow, and save it.
5. Link the repository to the project if the page asks.

## 4. Labels used by the templates

The work-package template applies the label `wp`, and the bug template applies `bug`, which GitHub has by default.
Create `wp` and `ready-to-merge` under **Issues**, then **Labels**, then **New label**. CI runs only on pull requests
labelled `ready-to-merge` (docs/process/workflow.md). The other labels in docs/PLAN.md section 5
(`area:*`, `crit:C1` to `crit:C5`, `wave:1`, `wave:2`, `blocked`) are optional.

## 5. Vercel

1. Open vercel.com, then **Add New**, then **Project**. If the repository is not in the list, choose **Import Git
   Repository** and install the Vercel GitHub app for `ismaeel-ch` with access to `Turnkey`.
2. Import `ismaeel-ch/Turnkey`. The framework is Next.js. Keep the default build command.
3. Under **Settings**, then **Environment Variables**, add these for **Production** only:
   - `LITELLM_BASE_URL`: the gateway's base URL.
   - `LITELLM_API_KEY`: the key. Mark it **Sensitive** so it cannot be read back.
   - `LITELLM_MODEL`: the model name for the careful tier.
   - `LITELLM_MODEL_FAST` (optional): the cheaper model for the Quick setting.
     Do not add any variable whose name starts with `NEXT_PUBLIC_`.
4. Merges and pushes do not deploy (`vercel.json` turns the Git integration off). Add the three secrets in
   docs/process/deploy.md, section One-time setup, so that publishing a release deploys.
5. Publish a release, or run **Release and deploy** by hand with the latest tag, so the new variables apply.
6. When it is ready, open `https://<your-project>.vercel.app/api/health?probe=1`. It should report that a model is
   configured and that the probe call succeeded. If it says the key is missing, check step 3 and deploy again.

## 6. Checks after setup

- A test pull request without the label gets only a failing `ci` check that says to add `ready-to-merge`. With the
  label it gets the `check`, nine `e2e` jobs and `ci` checks.
- The merge button offers squash only, and the head branch is deleted after the merge.
- A merge to `main` starts no Actions run and no Vercel deployment. Publishing a release starts **Release and
  deploy**, which ends with the production URL in its summary.
- Dependabot is off: there is no `.github/dependabot.yml`. To stop security-update pull requests as well, open
  **Settings**, **Code security**, and turn off **Dependabot security updates** (and **Dependabot version updates** if
  shown as on).
