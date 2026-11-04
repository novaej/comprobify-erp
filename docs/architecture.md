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
- **migrate** runs before each release as the owner role: SQL migrations, then the pg-boss schema and queues, the plan catalog, the default plan for any company without one, and the legal texts.

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

Three contexts exist, each set per transaction: tenant (everyday work), user (only for the user's own memberships and organizations, before a tenant is chosen) and system (cross-tenant jobs and the super admin area, logged with a reason). The super admin works outside any tenant, through a `PlatformActor`: `resolvePlatformActor` checks the flag, every admin call checks it again, and the `/admin` area also needs two-step verification. The `platform` module owns each admin workflow in one system-context transaction: it reads the company and its twin through `tenancy`, writes through `entitlements`, and records the change in the company's activity log.

### Policies

Every tenant-owned table has `tenant_id` and the standard policy from `app_enable_tenant_rls()`. A query without a tenant or system context raises `RLS: no tenant or system context` instead of returning nothing (ADR-004). Two tables differ, as ADR-010 records: `memberships` also admits the user context for the user's own rows, and `tenants`, keyed by `id`, admits the organizations the user belongs to; in user context both are read-only. The catalog test checks each table's exact policy. Cross-tenant work uses `withSystem(reason, …)`, which logs the reason. The app role can't bypass RLS, delete rows or change the schema, and web and worker refuse to start if it could (NFR-SEC-4).

## Plans and entitlements

Feature keys are a registry in `packages/core/src/entitlements/features.ts`, the only layer in code. Modules (sets of keys, the unit that is sold) and plans (modules plus limits) are platform data in `features`, `modules`, `module_features`, `plans`, `plan_modules` and `plan_limits` (ADR-011). The migrate step syncs new keys and seeds any starting module or plan missing by key; after that the super admin edits them, and the seed never overwrites a row. Every context can read the catalog. A statement trigger refuses writes outside system context, and feature keys are written by the migrate step only.

What a company has is tenant data under RLS: one `subscriptions` row (its plan, `PAID` or `COMPLIMENTARY`, and Personalizado's negotiated price), `subscription_items` (modules on top of the plan and Personalizado's limits) and `tenant_feature_overrides` (the operator's exceptions). Each is written to the real company and its twin in the same transaction, so the twin reads its own rows. A new company starts on Gratis in the transaction that creates it; the migrate step does the same for any company without a subscription. `entitlements` owns these tables, and `tenancy` calls its `startDefaultSubscriptions` instead of writing them.

`resolveActor` resolves them once per request into `ctx.entitlements`: the override wins, then subscription items, then the plan, then off. Boolean keys are the union of every module's keys; a coming-soon module grants nothing; a module or key removed with a date stays until the first period start after it (the Ecuador calendar month until billing has periods). Core checks with `requireFeature` (`FEATURE_NOT_ENABLED`) and `requireWithinLimit` (`LIMIT_REACHED`; a missing limit is 0, `null` is unlimited). The loader filters by `tenant_id` itself, so code without an actor, such as accepting an invitation, can resolve a company in system context.

The super admin edits the catalog from the platform area (`platform/catalog.ts` over `entitlements/catalog-admin.ts`): additions are immediate, and removals and lower limits are dated 30 days ahead, so they reach each company at its next period. Each change is recorded in `platform_audit_events`, append-only and written only in system context.

The web app only hides or locks: nav items carry a feature key, a page behind one renders `FeatureLocked`, and the plan page shows the plan, its modules and each limit with its usage (`planOverview`, `companyUsage`).

## Company settings

The company's tax data (accounting flag, contribuyente especial and agente de retención resolutions, the RIMPE regime), its branches and issue points, and the document types each issue point issues are edited from the Empresa page and written to the company and its twin together, matched by code (`tenancy/settings.ts`). New branches and issue points count against the plan's `MAX_BRANCHES` and `MAX_ISSUE_POINTS_PER_BRANCH`. Enabling a document type needs its `DOC_TYPE_*` feature and a builder for it; one already enabled keeps working if the plan loses it (FR-PLAN-3). Every enabled type has a row in `document_sequences`, per issue point: the twin counts its own. At go-live the owner can set the real company's next numbers, for a company coming from another provider; a sequence only moves forward.

## Master data

Clients (`parties`) and products and services (`catalog`) are tenant data under RLS, behind the `CLIENTS` and `CATALOG` features and the `clients.*` and `catalog.*` permissions. A company and its twin keep their own lists. Consumidor final is never a row. A cédula must pass its check digit; a RUC is checked by structure only, as onboarding does. Prices are `numeric` with six decimals and stay decimal strings end to end (ADR-012). Nothing is deleted: an inactive client or product drops out of the pickers and stays on its documents.

## Documents

The `documents` module holds every electronic document: one row per document, with the buyer and totals as a snapshot, and its lines, payments and timeline in `document_lines`, `document_payments` and `document_events`. Those three are append-only: the app role can't update them, so a correction adds a new revision of the lines and the row points at it. The status machine is one TypeScript definition (`DOCUMENT_TRANSITIONS` in `packages/db/src/schema/documents.ts`) that generates the status CHECK and the trigger body in the migration; a test compares the live trigger with it (FR-DOC-3). A second trigger keeps the number fixed forever, sets the authorization once, and lets the content and access key change only when a document goes back to `SIGNED` to be corrected or re-issued. Sequentials come from `document_sequences` under `SELECT … FOR UPDATE` in the creating transaction, so a rolled-back document gives its number back and two at once never share one. The access key is built in `sri/access-key.ts` with its Module 11 check digit, from the issue date in Ecuador time.

## Audit log

`audit_events` is tenant data with RLS, and append-only: the app role can insert and read, not update or delete. Core writes an event with `recordAudit` in the same transaction as the change, so a rolled-back change leaves none. Event names are one TypeScript list that generates the CHECK, and the web test requires a label for each. Changes to an organization and its twin are recorded in the real organization's log.

## Jobs

Queues are declared in `packages/core/src/jobs/registry.ts` with a Zod payload, options and concurrency. Schedules are declared there too, in `America/Guayaquil`. The migrate step creates the queues; the worker applies the schedules at start and removes ones no longer declared. Handlers must be idempotent (NFR-JOB-1).

## Startup

Web and worker load their env schema, then run the boot guard. Either failure stops the process with a list of problems. `/health` checks the database and queue, and deploys wait for it.
