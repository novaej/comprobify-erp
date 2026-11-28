# ADR-004: Fail-Loud Row-Level Security

## Status
Accepted

## Date
2026-11-01

## Context

Carried over from the previous system's row-level security work, simplified. That system reached fail-loud RLS in four steps, with separate tenant and issuer contexts, a shadow mode and a table-by-table rollout. This system starts empty, so it can go straight to the end state with one context (NFR-SEC-1, NFR-SEC-2).

Lessons kept from it:
- A query that silently returns nothing is a worse failure than an error.
- Postgres evaluates both sides of an `OR`, so the system check must also live inside the raising function.
- A role that bypasses RLS makes every test pass for the wrong reason.

## Decision

**Settings.** `app.tenant_id` and `app.rls_system`, set per transaction with `set_config(…, true)`. Transaction-local settings stay compatible with PgBouncer transaction mode (PRD 9.2).

**Functions** (first migration):

- `app_is_system()`: true only when `app.rls_system = 'on'`.
- `app_require_tenant_id()`: returns the tenant id; returns `NULL` in system context; otherwise raises `42501` with a message starting `RLS: no tenant or system context`.
- `app_enable_tenant_rls(regclass)`: enables and forces RLS on a table and creates its policy:

```sql
USING      (app_is_system() OR tenant_id = app_require_tenant_id())
WITH CHECK (app_is_system() OR tenant_id = app_require_tenant_id())
```

**Every tenant-owned table carries `tenant_id` directly,** including child tables such as `document_lines`. The old API's `EXISTS`-through-parent policies aren't carried over: they cost a join per row, and PRD section 8 requires the column.

**Application API** (`packages/db`):

- `withTenant(ctx, fn)` runs `fn` in a transaction with the tenant context.
- `withSystem(reason, fn)` requires a non-empty reason, logs it, and runs `fn` with the system context. The allowed callers are cross-tenant jobs and super admin.

Context is passed explicitly, not through `AsyncLocalStorage`, which the previous system tried and found hid which code ran in which context. NFR-ARCH-5 already passes the actor and transaction handle as arguments, so ambient state would add a second, invisible path.

**Issue-point restrictions stay in core** as query filters (NFR-SEC-3). RLS covers tenant isolation only.

**No SQL text built from values (Milestone 10).** `app.rls_system` is a setting, so SQL injection would be the way past it. Lint forbids `sql.raw` everywhere but the schema's generated CHECKs (`packages/db/src/schema/`), and requires what `client.query` or `executeSql` runs to be one literal written in place, with no `${…}`: a variable or a `+` would hide what went into it. Values go in as parameters, lists as arrays (`<> ALL($1::text[])`). The exemptions are commented in `packages/db/src/context.ts`: the `executeSql` wrappers themselves, and a savepoint's name in `inOneTransaction`, built from a counter, since Postgres takes no parameter there.

**No separate role for system context (Milestone 10).** Both processes use system context in ordinary work, not only the super admin area: billing, onboarding, notifications and bulk invoicing, 98 calls. Each process would hold both credentials, so a compromised process or a leaked `RUNTIME_ENV` gets both and the role adds nothing. What it would stop is injected SQL switching context, which the rule above already closes. It would cost a second pool in each process against the managed database's connection limit, a database user per environment, and every system call moved to it. Revisit if a process ever runs only tenant work, or if SQL text built at runtime becomes necessary.

**The catalog test (NFR-SEC-5)** runs as the app role and fails when any table outside `pg_catalog`, `information_schema`, `pgboss` and `drizzle` has a `tenant_id` column but lacks forced RLS or the standard policy, with no allow-list.

Milestone 0 has no tenant tables, because `tenants` belongs to Milestone 1. To keep the gate from passing vacuously, the integration test creates its own probe tables through the owner role: one protected table proves isolation, the raised error and system access; one unprotected table proves the catalog check reports it.

## Consequences

### Positive
- A forgotten context is an immediate, named error.
- Cross-tenant code is short, greppable and logged with a reason.
- There is no rollout state to reason about.

### Negative
- Every query needs a transaction, which adds `BEGIN`, `set_config` and `COMMIT`. Pipelining in `pg` can reduce this to one round trip; we'll measure before relying on it.
- `app.rls_system` is a session setting, not a privilege. RLS guards against application bugs, not a compromised credential.
- A query Postgres can prove returns nothing may not raise. Nothing leaks in that case.

## Alternatives considered

- **`AsyncLocalStorage` context**: the old API's approach, justified there by 170 existing queries. There are none here.
- **A separate `BYPASSRLS` role for system paths**: a real privilege boundary only for a process that holds one credential, and both hold both here. Decided against in Milestone 10, above.
- **A committed `rls_probe` table**: simpler test setup, but leaves a fake table in production schemas.
