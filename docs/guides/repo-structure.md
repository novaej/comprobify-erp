# How the repository is organized

What each folder holds, the layers the code is split into, and why it is built this way. It is the place to start before changing anything. [architecture.md](../architecture.md) describes the running system (processes, requests, jobs, each domain); the [ADRs](../adr/README.md) hold the full reasoning behind each decision; this guide connects the two to the folders.

## The short version

Comprobify is **one product in one repository**: a Next.js web app and a background worker, both built on one shared TypeScript core and one PostgreSQL database, shipped as one Docker image (ADR-001).

```
apps/web        what people use: pages, forms, downloads
apps/worker     what runs in the background: jobs, schedules, migrations
packages/core   every business rule
packages/db     the database: tables, migrations, row-level security
packages/config settings from the environment, and the logger
packages/ui     the design system: colours, type, components
tests/          integration and end-to-end tests
docs/           requirements, decisions, guides
infra/          local Docker, the web server, database setup
```

The rule that shapes everything: **business logic lives in `packages/core` and nowhere else.** The apps are thin: they turn a click or a job into a call to core, and core's answer into a screen or a log line. So the same rule runs the same way from a form, a background job, a test, or a future public API.

## Why one repository

The system this replaces was two repositories (an API and a web app) that had to be released together and kept drifting apart: a limit published by one that only the other could enforce, the same rows copied across two databases, two migration tools. Bringing everything into one place removes that class of problem:

- **One change, one commit.** A new field goes through the table, the rule and the screen together, reviewed as one diff.
- **One source for every shared definition.** A document status list, a role's permissions, a plan's features: each is defined once in TypeScript and imported, never copied.
- **One image to ship.** The web app and the worker run from the same Docker image with different commands, so they can never be out of step with each other or with the database.
- **No extra infrastructure.** PostgreSQL holds the data, the sessions and the job queue (pg-boss); there is no Redis or message broker to run (ADR-005).

The tools that make one repository work are **pnpm workspaces** (each folder under `apps/`, `packages/` and `tests/` is its own package with its own dependencies) and **Turborepo** (runs `build`, `test`, `typecheck` across packages in the right order, caching what didn't change). Versions are pinned exactly (ADR-002).

## The layers

Code depends in one direction only. A lower layer never imports a higher one:

```
              apps/web          apps/worker
                 │   \             │
                 │    packages/ui  │
                 ▼                 ▼
               packages/core ◀─────┘
                 │
                 ▼
               packages/db
                 │
                 ▼
               packages/config
```

ESLint enforces it (`eslint.config.mjs`): core can't import Next.js or React, nothing outside `packages/config` reads `process.env`, and a core module reaches another only through its `index.ts`. A wrong import fails `pnpm lint`, so the layering doesn't depend on anyone remembering it.

### `packages/config`: settings and logging

**Holds:** the schema of every environment variable for each process (`env.ts`, with Zod), the logger (`logger.ts`), and the shared TypeScript settings.

**Why it exists on its own:** it is the only code that reads `process.env`. Every setting is checked when a process starts; a bad or missing value stops the process with a list of every problem, instead of failing an hour later on the first request that needs it. An empty value counts as unset, so `PRICE=` can't silently become `NaN`. The logger writes only fields on an allow-list, so a header, a token or a certificate can't end up in a log by accident (ADR-008).

### `packages/db`: the database

**Holds:** the Drizzle schema (`src/schema/`, one file per area: documents, inventory, billing…), the SQL migrations (`migrations/`, generated from the schema and reviewed by hand), and the functions every query goes through (`context.ts`: `withTenant`, `withSystem`, `withUser`).

**Why it is built this way:**

- **Tenancy is enforced by the database, not by remembering a `WHERE`.** Every table a company owns has a `tenant_id` and row-level security that refuses any query without a company set. `withTenant` sets it for one transaction. A forgotten filter returns nothing instead of another company's data (ADR-004).
- **Two database roles.** Migrations run as an owner; the app runs as a role that can't bypass row-level security, and the app refuses to start if it could (ADR-003).
- **The schema is the source.** Status lists and their allowed transitions are TypeScript lists that generate both the database `CHECK`s and the code's checks, so the two can't disagree. Migrations only move forward and are never edited once merged.

### `packages/core`: the business rules

**Holds:** everything the product *does*. It is split into modules, one per area of the business:

| Module | What it owns |
|---|---|
| `kernel` | The pieces every module uses: the actor context (who is acting, in which company, with which permissions and plan), `DomainError`, the clock, Ecuador time, money arithmetic, CSV and ZIP, retention periods |
| `identity`, `tenancy` | Accounts, sign-in, sessions; companies, their test copy, members and roles, settings |
| `entitlements`, `billing`, `platform` | What each plan includes; prices, payments, renewals; the super admin's work |
| `sri`, `documents`, `certificates` | SRI's formats, the XML, signing, the SRI client; invoices, credit notes, guías and their life with SRI |
| `parties`, `catalog`, `masterdata` | Clients, providers, products, and copying them at go-live |
| `inventory`, `purchasing`, `sales`, `receivables`, `bulk` | Stock, purchase orders, sale orders, collections, batches of invoices |
| `notifications`, `email`, `audit`, `agreements`, `reports` | Notices, emails and their templates, activity logs, legal texts, dashboard and reports |
| `jobs` | The list of background queues and schedules, and the code that runs them |
| `testing` | Helpers for tests only (test certificates, a fake Payphone), imported as `@comprobify/core/testing` |

**How a core function looks:**

- It takes the **actor context first**: who is asking. It checks the permission and the plan itself, even if the screen already hid the button (FR-ROLE-3).
- Its **input and output are Zod schemas**, so whatever arrives from a form, a CSV or a job is validated in one place.
- It **fails with a `DomainError` and a stable code** (`QUOTA_EXCEEDED`, `STOCK_HELD`), which the screens turn into a message in the person's language.
- It **opens its own transaction** with `withTenant`, or takes one from its caller, and never reads settings or the HTTP request.
- **A module reaches another only through its `index.ts`**, never its tables. When one action spans modules (issuing an invoice from a sale order moves stock and updates the order), one function owns the transaction and calls each module's public functions inside it.

**Why:** business rules that live in a form handler get copied the day a second entry point appears (a batch, an import, an API). In core, they run the same from everywhere, and they are tested without a browser: most of the integration suite calls core directly against a real database.

### `packages/ui`: the design system

**Holds:** the colour and type tokens, the base components (buttons, inputs, dialogs, tables, built on shadcn), and the light and dark theme.

**Why it is separate:** the look is defined once. The pieces specific to this app's screens (page header, stack table, section card, confirm dialog, banners) are built from it in `apps/web/src/components/`, and every screen is built from those, so screens look and behave alike (FR-UX-2, ADR-006).

### `apps/web`: the web app

**Holds:** Next.js pages, server actions, route handlers and the UI strings.

- `src/app/[locale]/`: the pages, under the language (`/es`, `/en`). Route groups split them by who may enter: `(marketing)` for the public landing, pricing and support pages, `(auth)` for signing in, `(app)` for a signed-in person, with `(shell)` inside it for everything that needs a company and draws the sidebar, and `(admin)` for the platform area.
- `src/server/`: what pages and actions share on the server: the runtime (database, job queue, settings, built once per process), the session, loading the shell and the active company.
- `src/components/`: the shared screen blocks.
- `messages/es.json`, `messages/en.json`: every word on screen. Spanish is the default.

**Why it is thin:** a page reads through core, an action calls core and maps its answer; neither decides anything. That keeps the screens easy to change and means a rule can't be bypassed by a URL or a form someone builds by hand: core checks it anyway.

### `apps/worker`: the background process

**Holds:** the worker's entry point (registers core's job handlers and starts the schedules), the migrate step (runs before each release: migrations, queues, the plan catalogue, the legal texts, the email templates), and small operator scripts (`super-admin`, `test-certificate`, `run-job`).

**Why a separate process:** sending to SRI, retrying, nightly checks and emails must not wait on a person's request, and must survive a restart. A job is queued in the same transaction as the change that needs it, so a change that doesn't commit leaves no job behind (ADR-005).

### `tests/`

- `tests/integration`: core against a real PostgreSQL, as the app's database role, with row-level security on. This is where the rules are proven, including that no company can see another's rows.
- `tests/e2e`: Playwright through the real app in a browser, with an accessibility check on every screen it reaches.
- Unit tests sit next to the code they test (`*.test.ts`) and need no database.

They are separate packages so their dependencies (Playwright, test helpers) never reach the shipped image. See [testing.md](testing.md).

### `docs/`, `infra/` and the files at the root

- `docs/PRD.md` is what to build; `docs/architecture.md` how it fits together; `docs/adr/` why each choice was made; `docs/guides/` how to work in the repo; `docs/legal/` the legal texts' notes and retention periods. `docs/reference/` holds SRI's specification locally and is never committed.
- `infra/`: the Docker Compose stack, the Caddy web server config, the database bootstrap, and the reset scripts.
- At the root: `CLAUDE.md` (the rules every change follows), `NEXT_STEPS.md` (open work only), `CHANGELOG.md`, `GETTING_STARTED.md`, the `Dockerfile`.

## Where a new thing goes

| You are adding | It goes in |
|---|---|
| A rule, a calculation, a permission check | A function in the right `packages/core` module, exported from its `index.ts` |
| A table or a column | `packages/db/src/schema/`, then `pnpm db:generate` and review the SQL ([coding-guidelines.md](coding-guidelines.md#adding-a-table)) |
| A setting from the environment | `packages/config/src/env.ts`, and `.env.example` |
| A screen | `apps/web/src/app/[locale]/…`, built from `apps/web/src/components/`, its words in both message files |
| A background task or a schedule | A queue in `packages/core/src/jobs/registry.ts`, its handler in core, registered in `register-handlers.ts` |
| A decision someone will later ask "why" about | An ADR in `docs/adr/` |

## Follow one request

Issuing an invoice touches every layer, top to bottom:

1. The person submits the invoice form (`apps/web`). The server action builds the actor context from the session and calls `createInvoice` in core.
2. `createInvoice` (`packages/core/src/documents`) checks the permission, validates the input with Zod, and opens `withTenant`, a transaction limited to that company by the database.
3. Inside it: the quota (the plan's limit, from `entitlements`), the next number, the XML, the XSD check and the signature (`sri`, with the company's key from `certificates`), the rows, and a `sri.send` job, all in one transaction.
4. The transaction commits; the action sends the person to the invoice's page.
5. The worker (`apps/worker`) picks up `sri.send`, calls core's handler, which sends the XML to SRI and records its answer; another job asks for the authorization; then the buyer's email is queued.

If anything in step 3 fails, nothing is saved and no job exists: the number isn't spent and SRI is never called.
