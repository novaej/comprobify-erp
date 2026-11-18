# Deployment

How the system runs locally, on staging and in production (ADR-048). Backups and the restore drill join in Milestone 10.

## Environments

| | Hosts | Droplet | Postgres | Deploys |
|---|---|---|---|---|
| local | `localhost:3000` (`pnpm dev`), `localhost:8080` (`pnpm stack:up`) | your machine | the `postgres18` container | — |
| staging | `staging.comprobify.com` (public pages), `app-staging.comprobify.com` (app) | `comprobify-erp-staging`, `s-1vcpu-2gb`, `nyc1`, on demand | the staging cluster, created by hand | `main`, after CI passes |
| production | `comprobify.com`, `app.comprobify.com` (from cutover); `api.comprobify.com` later | `comprobify-erp-production`, `s-2vcpu-4gb`, `nyc1` | the production cluster, created by hand | a published GitHub Release |

Each environment is off until its repository variable is `true`: `STAGING_INFRA_ENABLED`, `PRODUCTION_INFRA_ENABLED`. While off, neither Terraform nor the deploy runs.

## One image, three commands

`Dockerfile` builds one image (ADR-001). The command picks the process:

| Process | Working directory | Command |
|---|---|---|
| web | `/app/apps/web` | `node_modules/.bin/next start` (the default) |
| worker | `/app/apps/worker` | `node --import tsx src/index.ts` |
| migrate | `/app/apps/worker` | `node --import tsx src/migrate.ts` |

The image runs as `node`, includes `xmllint` for SRI XSD validation, and pins `node:24-slim` by digest.

## Bringing an environment up

Done once per environment by the owner, in this order. Names in `backticks` are GitHub settings (Settings → Environments, or Secrets and variables → Actions).

1. **DigitalOcean.**
   - Check that the Project exists (`Comprobify Staging`, `Comprobify Production`): Terraform looks it up and never creates it.
   - Create the Postgres cluster in `nyc1` (PostgreSQL 18, the smallest size for staging), with its two roles and database ([Database roles](#database-roles-on-a-new-server)), and add the droplet to its trusted sources once it exists.
   - Create a Spaces key for this repo's Terraform state (`comprobify-terraform-state`).
2. **Deploy key.** Run `ssh-keygen -t ed25519 -C comprobify-erp-deploy-<env> -f ~/.ssh/comprobify_erp_<env>`. Use one key per environment, never shared.
3. **GitHub, repository.** Set the secrets `TERRAFORM_SPACES_ACCESS_KEY_ID` and `TERRAFORM_SPACES_SECRET_ACCESS_KEY`.
4. **GitHub, `<env>-infra` Environment.**
   - Secrets: `DO_TOKEN` and `CLOUDFLARE_TOKEN` (DNS edit on `comprobify.com`).
   - Variable: `INFRA_SSH_PUBLIC_KEY`, the `.pub` file's line.
5. **Infrastructure.** Set `<ENV>_INFRA_ENABLED=true`, then run **Terraform** manually (environment, `apply`). Its output `reserved_ip` is the droplet's address. Wait three to five minutes for cloud-init.
6. **GitHub, `<env>` Environment.** Production gets a required reviewer.
   - Secrets:
     - `DROPLET_IP`: the reserved IP.
     - `INFRA_SSH_PRIVATE_KEY`: the private key file.
     - `RUNTIME_ENV`: the whole `.env`, one `NAME=value` per line. See [Environment](#environment): `APP_ENV`, `APP_URL`, `LANDING_URL`, both database URLs with `?sslmode=require`, `AUTH_SECRET`, `CERT_ENCRYPTION_KEY`, Mailgun, `OPERATOR_RUC` and the rest.
   - Variables:
     - `DEPLOY_USERNAME`: `deploy_username` in the environment's `terraform.tfvars`.
     - `SITE_HOSTS`: `staging.comprobify.com, app-staging.comprobify.com`.
     - On staging's 2 GB, also `WEB_MEMORY=768m` and `WORKER_MEMORY=512m`.
7. **First deploy.** Staging: run **Deploy staging** manually. Production: publish a Release.
8. **Check.** `https://app-staging.comprobify.com/health` answers `{"status":"ok"}`, and the public pages answer on the landing host. Then make the operator account a super admin (below).

**Tearing staging down:** run **Terraform** manually (staging, `destroy`), then set `STAGING_INFRA_ENABLED=false`. The cluster is not Terraform's; delete it in DigitalOcean when it is no longer needed.

**Rebuilding a droplet** (after a cloud-init change, which is otherwise ignored): `terraform apply -replace=module.droplet.digitalocean_droplet.this` from the environment's folder. The reserved IP moves to the new droplet, so DNS and `DROPLET_IP` stay. Deploy again after it.

**Cutover** (production): before the ERP takes `comprobify.com` and `app.comprobify.com`, the previous web app's Terraform must release the two records. Remove them from its state or delete them there. Then set `manage_dns = true` in `environments/production/terraform.tfvars` and apply. The data migration runs before, and has its own runbook.

## Release order

`.github/workflows/deploy.yml` does this on staging and production; locally, `pnpm stack:up` does.

1. Run **migrate** to completion, as `comprobify_erp_owner`. It also publishes a new version of any legal text that changed in the repo, which asks every company to accept it again. It sets `lock_timeout`, so a held lock fails it fast instead of blocking traffic. Close any SQL client on the database first (Appendix B, lesson 12).
2. Start **web** and **worker** with the new image, as `comprobify_erp_app`.
3. Wait for `GET /health` to return 200 before routing traffic.

**Rollback:** release the previous tag again (run **Release to production** manually with it). Migrations don't go back, which is why each one must leave the schema usable by the code before it.

Both web and worker refuse to start, with a list of problems, if the env is invalid or the role is a superuser, has `BYPASSRLS`, or would see an unprotected tenant table.

## Local stack

```bash
pnpm stack:up     # build, migrate, then web, worker and Caddy on http://localhost:8080
pnpm stack:down
```

It uses `comprobify_erp_e2e` on the `postgres18` container on the host, through `host.docker.internal`, the same database as the E2E tests. `STACK_HTTP_PORT`, `STACK_DATABASE_URL`, `STACK_MIGRATION_DATABASE_URL` and `STACK_APP_URL` override the defaults. Logs are JSON.

## Database roles on a new server

Managed Postgres needs the two roles created by hand once, as an admin user (ADR-003). Use strong, unique passwords from the secret store:

```sql
CREATE ROLE comprobify_erp_owner LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE comprobify_erp_app   LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE comprobify_erp OWNER comprobify_erp_owner;
REVOKE ALL ON DATABASE comprobify_erp FROM PUBLIC;
GRANT CONNECT ON DATABASE comprobify_erp TO comprobify_erp_app;
```

The migrations grant the app role its rights. Managed Postgres requires TLS: connection settings for it are verified in Milestone 10.

## Super admins

The flag that opens the platform area is never set from the app (ADR-010). The operator sets it with the owner role, for an account that already exists:

```bash
pnpm super-admin <email>             # locally, from .env
pnpm super-admin <email> --revoke
# in the image: cd /app/apps/worker && node --import tsx src/super-admin.ts <email>
```

The area also requires two-step verification, so set it up on that account before going to `/admin`.

## Environment

`.env.example` lists every variable. An empty value counts as unset.

| Variable | Process | Notes |
|---|---|---|
| `APP_ENV` | all | `local`, `staging` or `production` |
| `LOG_LEVEL` | all | Default `info` |
| `LOG_FORMAT` | all | `json` (default) or `pretty`. The image only supports `json`. |
| `BETTERSTACK_SOURCE_TOKEN` | all | Optional. Ships logs to Betterstack. |
| `SENTRY_DSN` | all | Optional. Server-side errors only (ADR-008). |
| `DATABASE_URL` | web, worker | `comprobify_erp_app` |
| `MIGRATION_DATABASE_URL` | migrate | `comprobify_erp_owner` |
| `APP_URL` | web, worker | Public URL. Email links point here, the worker's billing emails too. |
| `LANDING_URL` | web | The public pages' own address when they live apart from the app (`https://comprobify.com` beside `APP_URL=https://app.comprobify.com`). Unset, one host serves both (ADR-048). |
| `CERT_ENCRYPTION_KEY` | web, worker | 64 hex characters (`openssl rand -hex 32`). Encrypts each company's stored certificate private key; never signs anything itself. The worker decrypts a company's key with it to sign that company's re-issues; losing it makes every stored key unusable, so back it up with the database credentials. |
| `AGREEMENTS_ENABLED` | web | `false` until the owner approves the legal texts (`docs/legal/review-notes.md`). When `true`, go-live requires acceptance. |
| `SUPPORT_PHONE` | web | Optional. A WhatsApp number with country code, shown with `SUPPORT_EMAIL` on the public support page. |
| `OPERATOR_NAME`, `OPERATOR_RUC`, `OPERATOR_ADDRESS`, `SUPPORT_EMAIL` | web | The operator named in the legal texts. Required when `AGREEMENTS_ENABLED` is `true`. `OPERATOR_RUC` is also printed on every document as "RUC Proveedor" (Anexo 26, ADR-013), so it is required in production whether or not agreements are on. |
| `CONSUMER_FINAL_MAX_AMOUNT` | web | The most a consumidor final invoice may total, `50.00` by default (FR-DOC-9). |
| `PAYPHONE_TOKEN`, `PAYPHONE_STORE_ID` | web, worker | Card payments through Payphone (ADR-033): both or neither. Unset, card payments are refused and transfers carry on. Leave them unset in a restored copy of real data. The token reaches the payer's browser (Payphone's widget needs it), so it is rotatable, not secret from a company. |
| `BANK_TRANSFER_BANK_NAME`, `BANK_TRANSFER_ACCOUNT_TYPE`, `BANK_TRANSFER_ACCOUNT_NUMBER`, `BANK_TRANSFER_ACCOUNT_HOLDER`, `BANK_TRANSFER_IDENTIFICATION` | web | The operator's account companies transfer to, shown with each payment: all five or none. Unset, the page asks the company to contact support for them. |
| `PAYPHONE_API_URL` | web, worker | Payphone's API, `https://paymentbox.payphonetodoesposible.com` by default |
| `PAYPHONE_CONFIRM_TIMEOUT_MS` | web, worker | The confirm call's limit, `10000` by default; it holds the attempt's lock |
| `AUTH_SECRET` | web | At least 32 characters. Signs session cookies and tokens; rotating it signs everyone out. |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` | worker | Required outside `local`. Locally, emails are logged instead. |
| `MAILGUN_REGION` | worker | `us` (default) or `eu` |
| `EMAIL_PROVIDER` | worker | `mailgun` sends, `log` writes each email to the log (local only), `none` sends nothing. Unset: `mailgun` with the keys, `log` locally without them (ADR-015) |
| `EMAIL_FROM_DOCUMENTS` | worker | The address buyers' copies come from, as "`<company>` via Comprobify". Unset: `EMAIL_FROM` |
| `EMAIL_REDIRECT_TO` | worker | Every email to this address instead, marked with who it was for: for a copy of real data or a demo. Refused in production. Staging also marks every email as a test |
| `EMAIL_FROM` | worker | Sender address |
| `SRI_MOCK_MODE` | web, worker | Answers like SRI without calling it (ADR-014). Refused when `APP_ENV=production`; forced on in the local stack and CI |
| `SRI_TEST_URL`, `SRI_PRODUCTION_URL` | web, worker | Base URLs of SRI's services; unset means SRI's own |
| `SRI_TIMEOUT_MS` | web, worker | Per request, `20000` by default |
| `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL` | tests only | Database name must end in `_test` |
| `E2E_DATABASE_URL`, `E2E_MIGRATION_DATABASE_URL` | E2E tests only | Database name must end in `_e2e`; defaults to the local one |

## Health

`GET /health` returns `{"status":"ok"}` when the database answers and the job queue exists, and 503 with `{"status":"unavailable"}` otherwise. It never includes details.
