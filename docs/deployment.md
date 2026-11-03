# Deployment

Milestone 0 deploys locally only. Staging and production infrastructure (Terraform, CD, backups) arrive in Milestone 10, and this document grows with them.

## One image, three commands

`Dockerfile` builds one image (ADR-001). The command picks the process:

| Process | Working directory | Command |
|---|---|---|
| web | `/app/apps/web` | `node_modules/.bin/next start` (the default) |
| worker | `/app/apps/worker` | `node --import tsx src/index.ts` |
| migrate | `/app/apps/worker` | `node --import tsx src/migrate.ts` |

The image runs as `node`, includes `xmllint` for SRI XSD validation, and pins `node:24-slim` by digest.

## Release order

1. Run **migrate** to completion, as `comprobify_erp_owner`. It also publishes a new version of any legal text that changed in the repo, which asks every company to accept it again. It sets `lock_timeout`, so a held lock fails it fast instead of blocking traffic. Close any SQL client on the database first (Appendix B, lesson 12).
2. Start **web** and **worker** with the new image, as `comprobify_erp_app`.
3. Wait for `GET /health` to return 200 before routing traffic.

Both web and worker refuse to start, with a list of problems, if the env is invalid or the role is a superuser, has `BYPASSRLS`, or would see an unprotected tenant table.

## Local stack

```bash
pnpm stack:up     # build, migrate, then web, worker and Caddy on http://localhost:8080
pnpm stack:down
```

It uses the `postgres18` container on the host through `host.docker.internal`. `STACK_HTTP_PORT`, `STACK_DATABASE_URL`, `STACK_MIGRATION_DATABASE_URL` and `STACK_APP_URL` override the defaults. Logs are JSON.

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
| `APP_URL` | web | Public URL. Email links point here. |
| `CERT_ENCRYPTION_KEY` | web | 64 hex characters (`openssl rand -hex 32`). Encrypts certificate private keys; losing it makes every stored key unusable, so back it up with the database credentials. |
| `AGREEMENTS_ENABLED` | web | `false` until the owner approves the legal texts (`docs/legal/review-notes.md`). When `true`, go-live requires acceptance. |
| `OPERATOR_NAME`, `OPERATOR_RUC`, `OPERATOR_ADDRESS`, `SUPPORT_EMAIL` | web | The operator named in the legal texts. Required when `AGREEMENTS_ENABLED` is `true`. |
| `AUTH_SECRET` | web | At least 32 characters. Signs session cookies and tokens; rotating it signs everyone out. |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` | worker | Required outside `local`. Locally, emails are logged instead. |
| `MAILGUN_REGION` | worker | `us` (default) or `eu` |
| `EMAIL_FROM` | worker | Sender address |
| `SRI_MOCK_MODE` | web, worker | Refused when `APP_ENV=production` |
| `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL` | tests only | Database name must end in `_test` |

## Health

`GET /health` returns `{"status":"ok"}` when the database answers and the job queue exists, and 503 with `{"status":"unavailable"}` otherwise. It never includes details.
