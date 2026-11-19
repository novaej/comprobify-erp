# ADR-051: The release pipeline and the docs site

## Status
Accepted

## Date
2026-11-18

## Context

ADR-048's first pipeline chained workflows:
- CI and Terraform each started on a push;
- "Deploy staging" started when either finished, asked GitHub how the other had gone, and deployed if it was the last;
- a Release started its own workflow.

It worked, but one merge showed four or five runs, several of them "skipped". Staging, meanwhile, is meant to be temporary: up for the cutover rehearsal and when something needs testing, down otherwise, while production stays.

Until now changes went straight to `main`. The owner wants pull requests, with `main` protected.

The previous API had a VitePress site at `docs.comprobify.com`, published to the Cloudflare Pages project `comprobify-docs`, and the public pages linked to it. This system's public API comes in Milestone 11+, but the address should keep working.

## Decision

**Changes reach `main` by pull request only.** A ruleset requires:
- CI's three checks (lint, types, unit tests and audit; integration tests; the Docker image), with the branch up to date;
- a squash merge, so the history is linear;
- no force push, no deletion, and no bypass.

No approval is required: the owner works alone and GitHub doesn't let an author approve their own pull request, so the checks are the gate. Release tags (`v*`) can't be moved or deleted. `docs/guides/git-flow.md` has the flow and the commands.

**One workflow per event, nothing waiting on another:**

| Event | Workflow | What it does |
|---|---|---|
| Pull request | `ci.yml`, and `terraform.yml` when `infra/terraform` changed | Checks, skipped when the PR changes only docs (`docs/`, `apps/docs/`, `*.md`); a plan for each environment that is up |
| Merge to `main` | `staging.yml` | CI (calling `ci.yml`, with E2E), then, while staging is up, Terraform if the merge changed `infra/terraform` (approved), then the deploy |
| Published Release | `production.yml` | Refuses a tag not `vX.Y.Z`; Terraform if `infra/terraform` changed since the previous release (approved); the deploy (approved) |
| Manual | `terraform.yml`, `staging.yml`, `production.yml`, `docs.yml` | Bring an environment up or down, redeploy staging, roll back or hotfix production from a tag, republish the docs |

`terraform-run.yml` is the one Terraform run, with the environment, action and ref as inputs, so every caller runs the same steps under one per-environment lock. It has two jobs in two GitHub Environments:
- **The plan** runs in `<env>-plan`, with no reviewer and read-only tokens (DigitalOcean Read Only, Cloudflare DNS: Read). It can't change anything, so it needs no approval, and its output is in the log.
- **The apply** runs in `<env>-infra`, with the reviewer and the tokens that can change things, and only when the plan found changes. It applies the saved plan itself, passed as an artifact for a day, so what was read is what runs. Terraform refuses a saved plan if the state moved after it. A destroy is planned and approved the same way.

The providers read their tokens from the environment (`DIGITALOCEAN_TOKEN`, `CLOUDFLARE_API_TOKEN`), not from Terraform variables: a saved plan holds every variable's value, and this one travels as an artifact.

**Staging comes and goes; production stays.** Staging is up for the cutover rehearsal and is destroyed after the first production release. It comes back only when something needs testing outside production, then goes again. `STAGING_INFRA_ENABLED` switches its Terraform and its deploys on and off together. A release doesn't depend on it, so production can be released while staging is up or down.

**The docs site** is `apps/docs`, a VitePress placeholder in Spanish (at the root) and English (`/en/`). It says the API documentation comes with the API and links to the app and to support. It isn't in the image (`.dockerignore`). `docs.yml` builds and publishes it with wrangler to `comprobify-docs` when a merge changes it, using repository secrets `DOCS_CLOUDFLARE_API_TOKEN` and `DOCS_CLOUDFLARE_ACCOUNT_ID`. The public header, footer and mobile menu link to it in the visitor's language (`apps/web/src/lib/docs.ts`). The API reference joins it with the public API.

## Consequences

### Positive

- A merge shows one Staging run, plus a Docs run when the docs changed. A pull request shows CI, plus a plan when the infrastructure changed.
- Staging costs nothing while it's off, and turning it on again is one switch and one apply, with production untouched.
- Infrastructure changes always pass a reviewer, both when planned on the pull request and when applied.

### Negative

- With staging down, a merge only runs CI. An infrastructure change merged then reaches staging when it next comes up (the manual apply builds from `main`) and production with the next release.
- With staging off, a release is tested by CI and locally only, unless staging is brought up for it.
- The rulesets and Environment rules exist only while the repository is public (GitHub's free plan). After it goes private they are conventions, and the switches and Releases are the remaining gates.
- The image is still built twice, in CI and in the deploy (ADR-048).

### Alternatives considered

- **Keeping the chained workflows.** They were correct, but noisy.
- **A `production` branch fast-forwarded by the Release**, as the previous API did. It adds a branch to protect and a push token, for what the tag already names.
- **Requiring an approval on pull requests.** A sole author can't give it, so it would mean bypassing the rule every time, which defeats it.
