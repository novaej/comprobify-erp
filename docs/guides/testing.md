# Testing

| Command | What | Needs |
|---|---|---|
| `pnpm test` | Unit tests in each package | Nothing |
| `pnpm test:integration` | `tests/integration`, against real Postgres with RLS on | `postgres18`, `pnpm db:setup` |
| `pnpm test:e2e` | `tests/e2e`, Playwright smoke test in Chromium | `pnpm db:setup`, then `pnpm build` |

## Unit tests

Next to the code, as `*.test.ts`. No database, no network. Take time from a `fixedClock`, never the real one.

## Integration tests

- They run as `comprobify_erp_app`, the same role as production, so RLS applies. A role that bypasses RLS would make them pass for the wrong reason.
- They refuse any database whose name doesn't end in `_test`, and migrate it themselves first.
- Fixtures that need DDL, such as probe tables, use the owner role through `asOwner()`. Give probe tables a unique name with `probeName()` and drop them afterwards.
- Files run one at a time, because probe tables are visible to the catalog check in other files.

The RLS catalog test (NFR-SEC-5) fails when any table with `tenant_id` lacks forced RLS or the standard policy. There is no allow-list.

The isolation sweep fills every tenant table with rows for two companies and a twin, then checks that no company sees another's rows. It finds the tables from the catalog, so a new table is checked automatically, and it fails if any table has no data, so give it data for each new table.

## E2E tests

They use their own database, `comprobify_erp_e2e` (`E2E_DATABASE_URL`, `E2E_MIGRATION_DATABASE_URL`; the name must end in `_e2e`), and Playwright migrates it before starting the app; the Docker stack's migrate step does it there. Every run leaves its accounts, companies and test plans behind, because nothing is deleted, so it is never the database used with `pnpm dev`. The Docker stack uses it too, so the tests can read its queued emails. `pnpm db:reset e2e` starts it over.

Playwright starts the built app on `:3000` unless `E2E_BASE_URL` is set:

```bash
pnpm build && pnpm test:e2e
E2E_BASE_URL=http://localhost:8080 pnpm test:e2e   # against the Docker stack
```

The account tests read the verification and reset links from the queued `email.send` jobs, so they need `DATABASE_URL` and no worker. Without a proxy in front, the app sees a loopback address and skips the per-IP rate limits, so E2E runs can repeat; through the Docker stack, the sign-up limit of 5 per address per hour applies.

When Playwright starts the app itself, it turns the legal texts on with test operator details, so CI covers accepting them before go-live. Against `E2E_BASE_URL` the tests follow that app's `AGREEMENTS_ENABLED`, which is off in `.env.example`.

Install the browser once with `pnpm --filter @comprobify/e2e-tests exec playwright install chromium`. Set the browser locale in a test that depends on language: the app picks it from `Accept-Language`.

## CI

`.github/workflows/ci.yml` runs lint, format, types, unit tests and the audit; integration tests against a `postgres:18` service; the Docker build; and, on pushes to `main`, the E2E smoke test.
