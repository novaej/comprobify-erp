# Architecture

How the system fits together. Requirements are in [PRD.md](PRD.md); the reasons behind each choice are in [adr/](adr/README.md).

## Processes

```
            ┌────────── one Docker image ──────────┐
 browser ─▶ Caddy ─▶ web (Next.js)      worker      migrate (runs once)
                       │                  │            │
                       └──── packages/core ┘            │
                                  │                     │
                           packages/db ─────────────────┘
                                  │
                          PostgreSQL 18: data, sessions, job queue
```

- **web** serves pages, server actions and route handlers. It only sends jobs.
- **worker** runs job handlers, cron schedules and queue maintenance.
- **migrate** runs before each release as the owner role: SQL migrations, then the pg-boss schema and queues.

There is no Redis or message broker. Postgres holds data, sessions and jobs (ADR-005).

## Packages

| Package | Holds | May import |
|---|---|---|
| `packages/config` | Env schemas, the logger, the shared tsconfig. The only reader of `process.env`. | — |
| `packages/db` | Drizzle schema, SQL migrations, `createDatabase`, the boot guard | `config` |
| `packages/core` | All business logic: kernel (actor context, `DomainError`, `Clock`), jobs, and the domain modules from Milestone 1 | `config`, `db` |
| `packages/ui` | Design tokens, shadcn components, the theme shim | — |
| `apps/web` | Next.js adapters: pages, actions, routes | all of the above |
| `apps/worker` | Worker and migrate entry points | `config`, `core`, `db` |

ESLint enforces the core rules: no Next.js or React in core, no `process.env` outside `packages/config`, and sibling modules only through their `index.ts` (NFR-ARCH-1, NFR-ARCH-4).

## Web routes

Under `apps/web/src/app/[locale]/`: `(auth)` holds the sign-in screens and sends signed-in users to the dashboard; `(app)` requires a session, and inside it `(shell)` requires an organization and renders the sidebar. Onboarding and the account page sit in `(app)` outside the shell, so they work before the first organization exists. `loadShell` picks the active organization with `chooseActiveOrganization`, the same rule the account page uses, and builds the actor context once per request.

## A request

1. Caddy terminates TLS and forwards to web.
2. `proxy.ts` assigns a request id and picks the locale (`/es`, `/en`).
3. A page or action builds the actor context and calls a core function.
4. Core opens `withTenant(ctx, …)`. Every query in it runs in one transaction with `app.tenant_id` set, so RLS limits it to that tenant.
5. If the work has follow-up, core enqueues a job on the same transaction. No commit, no job.

## Identity

Better Auth handles credentials, database sessions and tokens (ADR-009); its tables are global, with no `tenant_id`. Pages call server actions, which call `packages/core/src/identity`; no Better Auth HTTP route is mounted. Our code adds the rate limits, the verification page that consumes its token only on `POST`, and the idle timeout: `last_activity_at` moves only when the browser reports real input, and reading a session never extends it. Emails go through the `email.send` job.

## Tenancy and RLS

Onboarding checks the RUC's structure, reads the P12 whatever the CA, and requires the certificate to carry the RUC, or for a person their cédula. The private key is encrypted with AES-256-GCM before it reaches the database, and the certificate is stored on the organization and on its twin.


Organizations live in `tenants`. Registration creates two rows: the real organization (`PRODUCTION`) and its test twin (`TEST`, `twin_of` set), each with the same branch, issue point and warehouse, and the owner's membership mirrored in both (ADR-010). Child tables carry `tenant_id` and reference their parent through `(tenant_id, id)`, so a row can't point into another tenant.

Three contexts exist, each set per transaction: tenant (everyday work), user (only for the user's own memberships and organizations, before a tenant is chosen) and system (cross-tenant jobs and the super admin area, logged with a reason). The super admin works outside any tenant, through a `PlatformActor`.

### Policies

Every tenant-owned table has `tenant_id` and the standard policy from `app_enable_tenant_rls()`. A query without a tenant or system context raises `RLS: no tenant or system context` instead of returning nothing (ADR-004). Two tables differ, as ADR-010 records: `memberships` also admits the user context for the user's own rows, and `tenants`, keyed by `id`, admits the organizations the user belongs to; in user context both are read-only. The catalog test checks each table's exact policy. Cross-tenant work uses `withSystem(reason, …)`, which logs the reason. The app role can't bypass RLS, delete rows or change the schema, and web and worker refuse to start if it could (NFR-SEC-4).

## Audit log

`audit_events` is tenant data with RLS, and append-only: the app role can insert and read, not update or delete. Core writes an event with `recordAudit` in the same transaction as the change, so a rolled-back change leaves none. Event names are one TypeScript list that generates the CHECK, and the web test requires a label for each. Changes to an organization and its twin are recorded in the real organization's log.

## Jobs

Queues are declared in `packages/core/src/jobs/registry.ts` with a Zod payload, options and concurrency. Schedules are declared there too, in `America/Guayaquil`. The migrate step creates the queues; the worker applies the schedules at start and removes ones no longer declared. Handlers must be idempotent (NFR-JOB-1).

## Startup

Web and worker load their env schema, then run the boot guard. Either failure stops the process with a list of problems. `/health` checks the database and queue, and deploys wait for it.
