# ADR-048: Staging and production deployment

## Status

Accepted. It settles PRD section 12 for this repo, which replaces two deployed systems.

## Date

2026-11-18

## Context

PRD section 12 asks for one droplet per environment running Caddy, web and worker; managed Postgres; Terraform for the droplet, firewall, reserved IP and DNS; GitHub Actions for CD, staging from `main` and production from a GitHub Release; migrations before the new version, with `lock_timeout`, and a wait for `/health`. The previous systems ran exactly this shape in production from September 2026: one droplet each for the API and the web app, Cloudflare in front, Caddy on the droplet, Terraform state in the `comprobify-terraform-state` Spaces bucket, and a deploy over SSH as an unprivileged user. Their repositories will be deleted (CLAUDE.md), so what is kept from them is written here and into this repo's own files.

The owner's choices: the ERP gets its own droplet per environment. Each environment's Postgres cluster is created by hand, as before: a staging cluster now, a production cluster before go-live, then the staging one deleted. Staging runs on demand. At cutover the ERP takes over `comprobify.com` (the public pages) and `app.comprobify.com` (the app) from the previous web app, and later `api.comprobify.com` with the public API.

## Decision

**Terraform** (`infra/terraform`): one module (`modules/droplet`) and an environment each (`environments/staging`, `environments/production`).

- **Resources:** the droplet (plain Ubuntu 24.04, `resize_disk = false`), its SSH key, a reserved IP assigned separately (a droplet replacement keeps the address), and a firewall with 80/443 from Cloudflare's ranges only (fetched live) and 22 open. The droplet joins an existing DigitalOcean Project, looked up, never created. There is one proxied A record per hostname.
- **cloud-init** creates the deploy user (docker group, no sudo, no root login, key only), installs Docker from its own apt repository, and sets up fail2ban, unattended upgrades, 2 GB of swap and log rotation. `user_data` is ignored after creation, so a cloud-init edit never replaces a running droplet by accident. A rebuild is a deliberate `-replace`.
- **Postgres is not in Terraform.** The owner creates each cluster, and the two roles in it (docs/deployment.md).
- **State:** `comprobify-terraform-state`, under `<env>/comprobify/`, with a Spaces key for this repo alone.
- **Sizes:** both `s-1vcpu-2gb` in `nyc1` to start, with the containers capped at 768 MB (web) and 512 MB (worker). PRD 12 planned 2 vCPU / 4 GB for production. The owner starts smaller for cost, since production holds one company at cutover. The load test on staging (NFR-PERF-1, NFR-PERF-3) is on the same size, so it shows whether that holds. A droplet resizes in place, keeping its disk, IP and data; only `droplet_size` and the limits change.
- **DNS:** each environment's Terraform creates its own records. Production waited behind `manage_dns = false` while the previous web app's Terraform owned `comprobify.com` and `app.comprobify.com`; those records went with it, so it is on.

**The stack** (`infra/deploy`): `compose.yaml` runs `migrate` (a one-off, in a `release` profile), `web`, `worker` (CPU-capped) and Caddy from one image tagged with the commit. Caddy serves every hostname in `SITE_HOSTS` with its own certificates, trusts Cloudflare's ranges for the client address, and passes the client alone in `X-Forwarded-For`, which is what the app reads. Each environment's whole runtime `.env` is one GitHub Environment secret (`RUNTIME_ENV`), written to the droplet at each deploy, mode 600. The cluster's CA certificate is a secret beside it (`DATABASE_CA_CERT`), written and mounted read-only in the app's containers, so the database URLs verify the server (`sslmode=verify-full`). What isn't secret (the deploy user, the hostnames, the containers' memory and CPU limits) is in the environment's `terraform.tfvars`, which the deploy reads too, so no setting lives in two places.

**The pipeline** (`.github/workflows`):

- `deploy.yml` (reusable) builds and pushes the image to GHCR, copies the stack, and writes `.env`. It runs `migrate`, and a failure stops there with the old containers still serving. It then starts web, worker and Caddy, reloads Caddy, and waits up to two minutes for `/health`.
- The workflows that call it, and the release flow around them, are ADR-051: `main.yml` on a merge to `main`, `deploy-staging.yml` by hand, `production.yml` on a published Release, and `infrastructure.yml` for pull request plans and manual runs, all running Terraform through `infrastructure-job.yml`.

**Two hosts, one app.** With `LANDING_URL` set apart from `APP_URL`, the request proxy sends the public pages (`/`, `/es`, `/en` and their pricing and support pages) to the landing host and everything else to the app host, with a 308 that keeps the path and query (`apps/web/src/lib/hosts.ts`). Locally, and with `LANDING_URL` unset, one host serves both. Emails keep linking to `APP_URL`.

## Consequences

- Nothing exists until the owner turns a switch on. Bringing staging up is: switch on, apply, set `DROPLET_IP`, deploy. Tearing it down is a manual `destroy`, which leaves the database cluster, since that isn't Terraform's.
- The deploy has a short gap while web restarts (one container, no rolling update). It is acceptable at this size, and Caddy retries meanwhile.
- A rollback is a release of the previous tag. Migrations are forward-only, so the older code must tolerate the newer schema, which the forward-only rule already asks of every migration.
- Each commit's image is built once, by the first deploy that needs it, and production runs the one staging ran (ADR-051).

## Alternatives considered

- **The shared Coolify droplet** (`shared-infra`). Rejected by the owner: a 1 GB box shared with other apps, and Postgres in a container instead of a managed cluster with point-in-time recovery.
- **A production branch fast-forwarded by the release**, as before. Not needed: the release deploys its tag directly, and the Environment's reviewer is the approval.
- **One secret per variable.** Rejected: forty names to keep in step between the workflow, the docs and GitHub. One `RUNTIME_ENV` per environment is read and written as a whole.
