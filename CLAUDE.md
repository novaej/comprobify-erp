# CLAUDE.md

Primary guide for AI assistants and developers. Every rule here takes precedence over defaults. `docs/PRD.md` is the source of truth for what to build; this file is how to build it. Keep it current: it changes with every milestone.

**Status:** Milestones 1 (Identity and tenancy) and 2 (Entitlements and plans) done. Milestone 3 (SRI engine: factura) is next; see `NEXT_STEPS.md`. Decisions are in [docs/adr/](docs/adr/README.md).

---

## Working agreements

1. **Show the diff and wait for a go-ahead before committing.** No commit without explicit approval, every time.
2. **Keep code comments short.** Say why, not what. One line is the norm.
3. **Every change updates its docs in the same piece of work.** A change isn't done until its docs are (`docs/guides/documentation-checklist.md`).
4. **Read the surrounding code and tests before changing anything.**
5. **Commit and PR titles are `type: description`** (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`). Reference requirement ids in the body (`FR-…`, `NFR-…`).

---

## Project

Comprobify is a cloud ERP for Ecuadorian SMBs built around SRI electronic invoicing: one Next.js app plus one worker, sharing one TypeScript core and one Postgres database. It replaces the `comprobify` API + `comprobify-web` pair.

- Build in the order of PRD section 15. Each milestone is code + tests + docs, and its gate must pass before the next starts.
- `../comprobify` and `../comprobify-web` are **read-only** references. Port what PRD Appendix A lists, adapted to TypeScript and this architecture. Never edit them, and never copy their `.env` files.
- **This repo must stand alone: the old repositories will be deleted.** Never point code, comments or docs at them for content or reasoning (no "see API ADR-038", no paths into them). Copy what's needed into this repo and state the reason in place. A carried-over ADR holds the full reasoning itself.
- PRD vs old code: the PRD wins. PRD silent: prefer old behaviour and record the decision in an ADR.
- Reference requirement ids in commits, tests and ADRs.
- Track progress in `NEXT_STEPS.md`: tick a step in the same change that finishes it, and remove a milestone's section when its gate passes.
- SRI spec: Ficha Técnica v2.32, in `docs/reference/`. That folder is git-ignored and local only: never commit it, and ask the owner for the PDF if it's missing.

---

## Commands

```bash
pnpm install
pnpm dev                 # web + worker in watch mode
pnpm db:setup            # roles and databases on the local postgres18 container (see GETTING_STARTED.md)
pnpm db:migrate          # as the owner role: SQL migrations, then pg-boss schema and queues
pnpm db:reset <local|test|e2e|all>  # drop, recreate and migrate a local database; local asks first
pnpm db:generate         # new migration from the Drizzle schema
pnpm lint                # also enforces the core module boundaries
pnpm format              # Prettier; format:check in CI
pnpm typecheck
pnpm test                # unit, no database
pnpm test:integration    # real Postgres, RLS on, app role, database name must end in _test
pnpm test:e2e            # Playwright, against the built app or E2E_BASE_URL; its own _e2e database
pnpm build
pnpm stack:up            # Docker stack on :8080: caddy, migrate, web, worker, using the postgres18 container
pnpm stack:down
pnpm test-certificate <ruc>   # a test P12 (password: secret) to try onboarding locally
pnpm super-admin <email>      # give an existing account the platform area (--revoke takes it away)
```

---

## Architecture

```
apps/web        Next.js: UI, server actions, route handlers. Thin adapters only.
apps/worker     Job runner. Registers handlers from core.
packages/core   Domain modules. All business logic. No Next.js imports.
packages/db     Drizzle schema, SQL migrations, RLS helpers, seeds.
packages/ui     Shared shadcn components and design tokens.
packages/config Env parsing (Zod), the logger and the shared tsconfig.
tests/          Integration and E2E tests, each its own workspace package.
docs/           See PRD section 13.
infra/          Compose files, Caddyfile, Postgres bootstrap, scripts.
```

Both processes run from one Docker image. Postgres holds data, sessions and the job queue. There is no Redis or RabbitMQ.

---

## Critical rules

1. **Business logic lives in `packages/core`** (NFR-ARCH-1). Never in a React component, server action or route handler.
2. **Core functions take the actor context first** and a transaction handle optionally (NFR-ARCH-5). They never read `process.env` and never touch `Request`/`Response`.
3. **Modules call each other's public `index.ts`**, never each other's tables (NFR-ARCH-4). A cross-module workflow is one service function that owns the transaction.
4. **Core inputs and outputs are Zod schemas** (NFR-ARCH-2).
5. **Errors are `DomainError` with a stable `code`** (NFR-ARCH-6).
6. **Permissions are enforced in core.** Page and action checks are extra layers, never the only one (FR-ROLE-3).
7. **All data access goes through `withTenant`, `withUser` or `withSystem(reason, …)`** (NFR-SEC-2). `withUser` is for identity lookups only: the user's own memberships and organizations (ADR-010). System context needs a real reason string and is logged; the super admin area uses it for cross-tenant reads. The one exception is `db.identity`, for the global identity tables only (ADR-009).
8. **Every tenant-owned table has `tenant_id` and forced RLS with the fail-loud policy** (NFR-SEC-1). Use `app_enable_tenant_rls()` in the migration; the catalog test fails otherwise.
9. **The app role is never a superuser or `BYPASSRLS`** (NFR-SEC-4). Migrations run as the owner role, and the app refuses to boot on a role that bypasses RLS.
10. **Enqueue jobs in the same transaction as the business write**, through the transaction handle. Never send from the pooled connection after commit. The one exception is Better Auth's emails, whose write isn't ours (ADR-009).
11. **Job handlers are idempotent** (NFR-JOB-1): re-fetch by id, check state, then act. Schedules are declared in code with an explicit time zone (NFR-JOB-2).
12. **No hard deletes.** Use status or `active`. The app role has no `DELETE` grant on application tables. Twin reset is the one exception (PRD glossary).
13. **Never interpolate SQL.** Use Drizzle or `sql` parameters.
14. **Never use floats for money or quantities.** `numeric` in the database, a decimal library in the domain.
15. **All date decisions use Ecuador time** (UTC-5, no DST) through one helper module. Servers run UTC.
16. **Migrations are forward-only**, set `lock_timeout`, and never get edited once merged.
17. **Status CHECKs and triggers are generated from the TypeScript definition** (FR-DOC-3). Never keep two hand-written copies.
18. **Every UI string is in the message files.** Spanish is the default, English secondary.
19. **Every screen looks and behaves like the others** (FR-UX-2). Build it from the shared blocks in `apps/web/src/components/` (page header, stack table, section card, form and confirm dialogs, toned badges, empty state, banner, `ChoiceSelect`), copying the structure of an existing screen of the same kind. No hand-rolled headers, lists or native selects; anything destructive or immediate asks first. `look()` in the E2E suite runs axe on every screen it reaches.
20. **English for identifiers, tables and columns.** Spanish only where SRI mandates it (XML element names).
21. **Log fields are an explicit allow-list.** Never log headers, query strings, tokens or P12 data.

---

## Tenancy in one paragraph

Deployment environment (`APP_ENV`: local, staging, production) and tenant mode (`TEST`, `PRODUCTION`) are separate. A test twin is another `tenants` row linked by `twin_of`, isolated by normal RLS; there is no sandbox schema and no environment column. `twin_of` is used only by the switcher, certificate copy, plan inheritance, membership mirroring and master-data copy. Memberships are mirrored as rows in the twin, so its own RLS reads them. The session's `active_tenant_id` picks the tenant, and `resolveActor` builds the actor context from the membership. The super admin area is platform work, outside any tenant (ADR-010). Ambiente is `2` only for a `PRODUCTION` tenant on the production deployment, computed in one function (FR-ONB-6).

---

## Common mistakes

From the old systems (PRD Appendix B). Each came from a real incident.

1. Deriving billing period dates from "now" except for the first period and promotion. Anchor to the previous period end and clamp month-end arithmetic.
2. Wrong daily billing order. It is seat changes, then tier changes, then renewals.
3. Pricing a deferred period at today's price. Use the price and seat count in effect on the date it starts.
4. Signing before XSD validation, or ignoring element order.
5. Single-use tokens consumed on `GET`. Link scanners prefetch: `GET` checks, `POST` consumes.
6. Logging auth headers or query strings.
7. `parseInt` on a UUID. Parse UUIDs as UUIDs.
8. Letting `NaN` reach the database, where it is a valid numeric. Check that source fields exist.
9. Treating an empty env var as unset. `parseFloat('')` is `NaN`. Validate config at startup.
10. Excluding files read at runtime from the Docker image through `.dockerignore`.
11. Leaving Cloudflare email obfuscation on for app hosts. It breaks proxied HTML containing emails.
12. Leaving a SQL client open during a deploy. It blocks migrations. Set `lock_timeout` and wait for health.
13. Restoring a production copy with email, webhooks and payments still live.
14. Changing a state transition in code but not in the DB trigger. Generate both from one source.
15. Sharing one rate limiter across abuse vectors, or using an in-process store with several instances.
16. Counting background polling as user activity for session idle timeout.
17. Payphone: confirm within 5 minutes, persist the vendor id even if saving the outcome fails, never apply a duplicate charge, minimum charge $1.00.
18. Displaying a payment from the subscription's current tier. Use `total_amount` and the payment's target tier and interval.

Found while setting up this repo:

19. Creating queues from the web or worker process. `createQueue` runs DDL for partitioned queues, so queues come from the registry in the migrate step, as the owner role.
20. Treating `FORCE ROW LEVEL SECURITY` as owner-exempt. A migration that reads rows of an RLS table needs `app.rls_system`, set and cleared in its SQL: a data migration, and also adding a foreign key to a table with RLS and rows, because Postgres validates it with a query.
21. Reusing role names from other projects. Postgres roles are cluster-wide and the local `postgres18` container is shared, so this repo uses `comprobify_erp_owner` and `comprobify_erp_app`, never `comprobify_app`.
22. Keeping a server singleton in a module variable in `apps/web`. Next bundles `instrumentation.ts` and routes separately, so each gets its own copy. Keep it on `globalThis`.
23. Leaving a pino transport out of `apps/web`'s dependencies. Inside a Next build, pino resolves transports from the app, so `pino-pretty` and `@logtail/pino` must be listed there too.
24. Deciding the log format from `APP_ENV`. The image has no `pino-pretty`, so pretty logs crash it. `LOG_FORMAT` decides, and the stack forces `json`.
25. Using `instanceof` on errors in `apps/web`. Next bundles core more than once, and the runtime on `globalThis` comes from another bundle than the action, so `instanceof DomainError` fails. Use `isDomainError`, which checks a `Symbol.for` brand.
26. Giving a form an `action` prop. React 19 resets it after the action runs, so an error wipes what the user typed. Use `useFormAction`, which submits through `onSubmit`.
27. Reading the session from `headers()` in a server action. It keeps the cookies the request arrived with, so after Better Auth rotates the session (2FA setup) the page sees no session. `currentHeaders()` builds the Cookie header from `cookies()`, which has the new one.
28. Redirecting from a server action that changes the organization or its mode without `revalidatePath(`/${locale}`, 'layout')`. Pages in `(shell)` share its layout, which the client reuses, so the badge, banners and switcher stay stale.
29. Expecting RLS to refuse a write. A policy-denied `UPDATE` matches no rows and succeeds. Guard writes that must fail loud with a trigger that raises, as `app_protect_platform_table` does.
30. Importing a constant from a `'use client'` file into a server component. It arrives as a client reference, not the value, so a lookup quietly returns `undefined`. Shared constants go in a plain module both can import.

**Left behind on purpose** (never port): reserved API keys and pool, `requireInternalService` and the BFF secret, P12-based recovery and `alreadyLinked`, promotion key mirroring, tenant = API key identity, duplicated rows across databases, the notification-sync webhook receiver, the `sandbox` schema and `tenants.sandbox`, RabbitMQ with `pending_effects` and its sweep, droplet cron jobs, two migration tools.

---

## SRI

Read PRD sections 5.8 and 6 before touching documents. `docs/domain/sri.md` expands them from Milestone 3. The rules most often broken:

- Reception codes 43 and 70 mean SRI holds the document: `RECEIVED`, never `RETURNED`.
- Only transport errors are retried. A clean SRI answer never is.
- A rejected document is corrected and resent as the same row and sequential. Never a new number.
- Issue date is the transmission day, in Ecuador time.
- The RIDE is built from the authorized XML, never from live data.

---

## Key files

| Path | What |
|---|---|
| `docs/PRD.md` | Requirements and delivery plan |
| `NEXT_STEPS.md` | Current progress and open work |
| `docs/adr/` | Decisions and why |
| `packages/db/src/context.ts` | `createDatabase`, which gives `withTenant` and `withSystem` |
| `packages/db/src/boot-guard.ts` | Boot guard and the catalog check it shares with the test |
| `infra/postgres/bootstrap.sql` | Local roles and databases |
| `packages/db/migrations/` | Reviewed SQL migrations |
| `packages/config/src/env.ts` | Env schemas per process |
| `packages/config/src/logger.ts` | Allow-listed logger |
| `packages/core/src/kernel/` | Actor context, `DomainError`, `Clock`, entitlement checks, Ecuador time (`ecuador-time.ts`, the one place for rule 15) |
| `packages/core/src/jobs/` | Queue registry and schedules |
| `packages/core/src/identity/` | Better Auth setup, rate limits, sessions and idle timeout |
| `packages/core/src/tenancy/` | Organizations and twins, roles and permissions, actor context, ambiente |
| `packages/core/src/entitlements/` | Feature key registry, the starting modules and plans, `syncCatalog`, subscriptions, the resolver, the catalog editors' rules on notice (ADR-011) |
| `packages/core/src/platform/` | The super admin's workflows: companies, their plans, add-ons, Personalizado, complimentary, overrides; editing plans and modules |
| `apps/web/src/app/[locale]/(admin)/` | The platform area, outside any company (`loadPlatform`) |
| `packages/core/src/sri/` | SRI catalogues (from `packages/db/src/schema/sri.ts`), totals and rounding (ADR-012), access keys, the factura builder, XSD validation and the XAdES-BES signer (ADR-013); the client from Milestone 3 |
| `packages/core/src/documents/` | `createInvoice` (the FR-DOC-2 pipeline), status machine checks and sequentials; the table, transitions and trigger generator are in `packages/db/src/schema/documents.ts` (FR-DOC-3) |
| `packages/core/src/parties/`, `packages/core/src/catalog/` | Clients with identification checks; products and services (FR-MD-1, FR-MD-2) |
| `packages/core/src/agreements/` | Legal texts (`texts/*.md`, published by the migrate step), personalization, acceptance |
| `docs/legal/review-notes.md` | What changed in the legal texts and the open legal questions |
| `packages/core/src/audit/` | `recordAudit` (same transaction as the change), the activity list, sign-ins |
| `packages/core/src/tenancy/settings.ts` | Tax data, branches, issue points, their document types, starting sequentials (all mirrored in the twin) |
| `packages/core/src/tenancy/members.ts` | Invitations, role changes, removal, issue-point restrictions, all mirrored in the twin |
| `packages/core/src/certificates/` | P12 parsing, the RUC match, key encryption |
| `packages/core/src/testing/` | Test helpers, such as generated P12 files (`@comprobify/core/testing`) |
| `packages/core/src/email/` | Email templates, Mailgun and the local log provider |
| `apps/web/src/server/session.ts` | `getSession` and `requireSession` for pages |
| `apps/web/src/server/request.ts` | `currentHeaders()` and `requestMeta()`: the cookies as they are now, and the client address |
| `apps/web/src/server/shell.ts` | `loadShell`: session, organizations, active organization, actor, certificate status |
| `apps/web/src/components/shell/` | Sidebar, organization switcher, top bar |
| `apps/web/src/components/feature-locked.tsx` | What a page shows when the plan lacks its feature |
| `apps/web/src/components/` | The shared screen blocks every page is built from (rule 19) |
| `tests/e2e/look.ts` | axe on every screen, both themes; `E2E_SCREENSHOTS=<dir>` saves desktop and phone shots |
| `packages/ui/` | Design system: tokens, components, theme |
| `apps/web/messages/` | UI strings, `es` and `en` |
| `apps/web/src/server/runtime.ts` | The web process's env, logger, database and jobs |
| `tests/integration/rls-catalog.test.ts` | NFR-SEC-5 catalog test |
| `tests/integration/isolation-sweep.test.ts` | Every tenant table, from the catalog, proven isolated between companies and twins |
| `tests/e2e/smoke.spec.ts` | Playwright smoke test |
| `Dockerfile`, `infra/compose.yaml` | The image and the local stack |
| `.github/workflows/ci.yml` | CI |
| `docs/architecture.md`, `docs/guides/` | How the system fits together, and how to work in it |
