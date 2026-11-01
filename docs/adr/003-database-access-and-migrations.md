# ADR-003: PostgreSQL 18, Drizzle, SQL Migrations, Two Roles

## Status
Accepted

## Date
2026-11-01

## Context

RLS policies, triggers, CHECKs and partial indexes are central to this schema, so the data layer has to treat SQL as first-class. The transaction must also be shared by Drizzle, `set_config` and pg-boss (ADR-005). NFR-SEC-4 separates the app role from the migration role, while the old API's app role owned its own tables. PRD section 8 wants UUIDv7 generated in the database, and PostgreSQL 18 has it built in. The local `postgres18` container (18.4) is shared with the old repositories and other projects, and Postgres roles are cluster-wide.

## Decision

**PostgreSQL 18 and Drizzle ORM** over node-postgres. `drizzle-orm` stays on stable 0.45.4, not the 1.0 release candidate.

**Migrations are committed SQL.** `drizzle-kit generate` writes the file, and hand-written SQL (functions, policies, triggers) goes in `--custom` migrations. All are reviewed, forward-only, and never edited after merge. `pnpm db:migrate` sets `lock_timeout` before applying anything.

**Our transaction owns the connection.** `withTenant` and `withSystem` check out a `pg` client, run `BEGIN`, set the context, and pass a handle holding a Drizzle instance bound to that client plus a pg-boss `IDatabase` adapter over it. This is needed because `tx.execute` in Drizzle can't take the `(text, values)` calls pg-boss makes.

**Two roles:**

| Role | Used by | Rights |
|---|---|---|
| `comprobify_erp_owner` | `migrate` only | Owns all objects |
| `comprobify_erp_app` | `web`, `worker` | `SELECT`, `INSERT`, `UPDATE` on application tables; no `DELETE`; no DDL; not superuser; no `BYPASSRLS` |

The `erp` in the names avoids the existing `comprobify_app` role, which belongs to the old API. Databases are `comprobify_erp_local` and `comprobify_erp_test`.

Grants come from `ALTER DEFAULT PRIVILEGES`, so new tables need no grant lines. Withholding `DELETE` enforces "no hard deletes" in the database. Twin reset (Milestone 1) will use a dedicated function that refuses non-`TEST` tenants.

**Boot guard.** Web and worker refuse to start if the connected role is a superuser or has `BYPASSRLS`, ported from `comprobify-web/scripts/check-db-role.js`, including the check that every protected table has RLS forced.

**UUIDv7 from the native `uuidv7()`,** as the `DEFAULT` on every primary key. This carries over API ADR-020's choice of UUIDv7 without its hand-written function.

DigitalOcean Managed Databases offers PostgreSQL 18 (confirmed by the owner), so production matches local and CI.

## Consequences

### Positive
- Policies, triggers and CHECKs are plain, reviewable SQL.
- The app's database credentials can't change schema or delete rows, even through a bug.
- Enqueuing and business writes share one transaction with no outbox.

### Negative
- Hand-written SQL isn't visible to Drizzle's schema, so drift between the two needs review.
- Owner-run data migrations hit forced RLS and must set `app.rls_system` themselves.
- Managed Postgres needs both roles created by hand at first deploy, which `docs/deployment.md` has to cover.

## Alternatives considered

- **Prisma**: used by `comprobify-web`, but raw SQL is second-class and interactive transactions with `set_config` are awkward.
- **Plain `pg` with SQL files**: used by the old API. Works, but every query's types are hand-written.
- **PostgreSQL 17 with a hand-written `uuid_generate_v7()`**: the PRD's original version, but it needs a function the database now provides, and the old API's CI and local setup are already on 18.
