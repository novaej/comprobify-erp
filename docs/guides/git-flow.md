# Git flow

How a change travels from a branch to production, and the GitHub settings that hold it to that path. The pipeline behind it is ADR-051.

## The path of a change

```
feat/xyz ──PR──▶ main ──▶ Main (E2E, staging's Terraform)
                  │
                  ├─ you run "Deploy to staging" ──▶ staging, while it's up
                  │
                  └─ tag vX.Y.Z ──▶ GitHub Release ──▶ Release to production ──▶ production
```

| Workflow (Actions) | Started by | Does |
|---|---|---|
| **CI** | a pull request | lint, types, unit tests and audit, integration tests, the image; the docs site's build when `apps/docs/` changed |
| **Main** | a merge to `main`, unless it changes only docs | E2E; while staging is up, Terraform when `infra/terraform` changed (approved) |
| **Deploy to staging** | you, by hand | deploys `main`'s newest commit whose Main run passed |
| **Release to production** | publishing a Release | Terraform when `infra/terraform` changed since the last release (approved), then the deploy (approved) |
| **Infrastructure** | a pull request touching `infra/terraform`, or you | a plan; or a manual plan, apply or destroy |
| **Docs** | a merge changing `apps/docs/` | publishes docs.comprobify.com |
| *Deploy (shared job)*, *Infrastructure (shared job)* | never directly | the deploy and the Terraform steps the others call; their jobs appear inside those runs |

1. **Branch from `main`.** Name it by the commit type: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/` or `ci/`, then a few words, such as `feat/branch-selector`.
2. **Commit** with `type: description` titles. Requirement ids (`FR-…`, `NFR-…`, `ADR-…`) go in the body (CLAUDE.md, working agreements).
3. **Open a pull request into `main`.** Its title follows the same `type: description` form. It becomes the squash commit's title, so it's what `main`'s history shows. The body follows the template (`.github/pull_request_template.md`): why, what changes, how it was checked, screens for UI, the checklist of this repo's rules, anything to do on deploy, and how to roll back. Leave out what doesn't apply.
   - CI runs: lint, types, unit tests and audit, integration tests, and the Docker image. All three are required. A PR that only changes docs (`docs/`, `apps/docs/`, `*.md`) skips them, and skipped counts as passed; any other file runs all three. A PR that touches `apps/docs/` also builds the docs site.
   - A change under `infra/terraform` also gets a Terraform plan for each environment that is up, with no approval needed: read it before merging.
4. **Squash-merge** once CI is green. The branch is deleted on merge.
5. **The merge runs Main**, once, unless it changes only docs:
   - The E2E smoke test. The other checks passed on the PR, and the merge holds exactly that code, since `main`'s ruleset requires the PR to be up to date.
   - While staging is up: Terraform, if the merge changed `infra/terraform`, after its approval.

   It deploys nothing.
6. **Deploy to staging when you choose:** `gh workflow run deploy-staging.yml`, or Actions → Deploy to staging → Run workflow, from `main`. It deploys `main`'s newest commit whose Main run passed, which may cover several merges. It refuses while Main is still running on the latest commit, or after it failed there.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens pull requests every Monday morning for pnpm packages, GitHub Actions, the image's base, Caddy and the Terraform providers. A release is proposed only once it is 14 days old.
- Minor and patch updates come grouped. A major version, or any update to the framework, auth, the database layer, the queue or the signer, comes on its own.
- They pass CI like any other pull request. Read the changelog of anything that comes alone, then squash-merge.
- A provider update's Infrastructure plan fails, because Dependabot's runs get no secrets. Run a plan by hand (Actions → Infrastructure) before merging it.
- Security updates come whenever GitHub learns of an advisory, outside the schedule, once **Dependabot security updates** is on (Settings → Code security).

## Releasing to production

Production stays live once it is up. Staging is temporary: it's up now for the cutover rehearsal, is destroyed after the first production release, and comes back only when something needs testing outside production. Its switch, `STAGING_INFRA_ENABLED`, turns its infrastructure and its deploys on and off together. A release doesn't depend on it.

1. **Test**, on staging when it's up (run Deploy to staging first), with `docs/guides/qa-script.md` for a full pass. Release the commit staging runs, shown in its deploy's summary: production then reuses the same image.
2. **Prepare the release** with a PR named `chore: release vX.Y.Z`. In `CHANGELOG.md`, it renames `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and opens a new empty `[Unreleased]` above it. Merge it.
3. **Publish a GitHub Release** (Releases → Draft a new release). Create the tag `vX.Y.Z` on `main`, use the changelog section as the notes, and publish. This starts the Release to production workflow:
   - It checks that production is switched on and that the tag is `vX.Y.Z`.
   - Terraform plans if `infra/terraform` changed since the previous release. If the plan changes something, its apply waits for the `production-infra` reviewer.
   - The deploy runs after the `production` reviewer approves. It runs the image staging ran for that commit, now also tagged `vX.Y.Z`; one is built only if no staging deploy reached that commit.
4. **Check** `https://app.comprobify.com/health`.

### Staging off and on

- **Off**, after the first production release and whenever it's no longer needed: run the Infrastructure workflow (staging, `destroy`), then set `STAGING_INFRA_ENABLED=false`. From then on, a merge to `main` runs E2E only. The database cluster isn't Terraform's: delete it in DigitalOcean, or keep it for the next time.
- **On again:** create the cluster if it was deleted (`docs/deployment.md`, "Database roles on a new server"), set `STAGING_INFRA_ENABLED=true`, then run the Infrastructure workflow (staging, `apply`). Update `DROPLET_IP` with the new reserved IP and add the droplet to the cluster's trusted sources, then run Deploy to staging. Production keeps running throughout.

Versions follow semantic versioning: the major for a change companies must act on, the minor for features, the patch for fixes. The first production release is `v1.0.0`, at cutover.

### A fix that can't wait

If `main` holds nothing unreleased, fix it on `main` through a PR and release the next patch as usual.

If `main` already holds unreleased work, branch from the release in production instead:

```bash
git switch -c hotfix/short-name vX.Y.Z
# fix, commit, push, and let CI run on a PR into main (don't merge it yet)
git tag vX.Y.(Z+1) && git push origin vX.Y.(Z+1)
```

Then publish a Release from that tag; it deploys like any other. Afterwards, merge the hotfix PR into `main` so the fix is in the next release.

A manual run of Release to production must start from the tag (`--ref`): the `production` Environment accepts only `v*` tags, so a run started from `main` is refused.

### Rolling back

Run Release to production from the previous tag:

```bash
gh workflow run production.yml --ref vX.Y.Z
```

Migrations are forward-only, so the older code must work with the newer schema, which every migration already guarantees (rule 16).

## GitHub settings

Set once by the owner. They apply while the repository is public: on GitHub's free plan a private repository has no rulesets and no Environment rules. If it goes private, these become conventions only.

### Repository

Merge commits and rebase merges off, squash on with the PR's title and body, branches deleted after merge:

```bash
gh api -X PATCH repos/novaej/comprobify-erp \
  -F allow_merge_commit=false -F allow_rebase_merge=false -F allow_squash_merge=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
  -F delete_branch_on_merge=true
```

### Ruleset on `main`

`main` changes only by pull request with CI green. Nobody force-pushes it or deletes it, and no one bypasses the rule, the owner included. No approval is required, since a sole author can't approve their own pull request; the required checks are the gate.

```bash
gh api -X POST repos/novaej/comprobify-erp/rulesets --input - <<'EOF'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Lint, types, unit tests, audit" },
          { "context": "Integration tests" },
          { "context": "Docker image" }
        ]
      }
    }
  ]
}
EOF
```

`strict` asks the branch to be up to date with `main` before merging, so what was checked is what lands.

### Ruleset on release tags

A `v*` tag, once pushed, is what production ran: it is never moved or deleted.

```bash
gh api -X POST repos/novaej/comprobify-erp/rulesets --input - <<'EOF'
{
  "name": "release tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [{ "type": "deletion" }, { "type": "update" }, { "type": "non_fast_forward" }]
}
EOF
```

### Environments

Required reviewers on `staging-infra`, `production-infra` and `production`, none on `staging-plan` and `production-plan` (they hold read-only tokens), with deployment branches `main` on `staging` and tags `v*` on `production` (`docs/deployment.md`, step 6). `staging` deploys every merge without asking.

### Code security

Dependabot alerts and security updates, and secret scanning with push protection, which refuses a push holding a token or key:

```bash
gh api -X PUT repos/novaej/comprobify-erp/vulnerability-alerts
gh api -X PUT repos/novaej/comprobify-erp/automated-security-fixes
gh api -X PATCH repos/novaej/comprobify-erp \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

### Check them

```bash
gh api repos/novaej/comprobify-erp/rulesets --jq '.[] | "\(.name): \(.enforcement)"'
gh api repos/novaej/comprobify-erp --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge, delete_branch: .delete_branch_on_merge}'
```
