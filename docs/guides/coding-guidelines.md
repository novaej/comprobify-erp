# Coding Guidelines

The rules in [CLAUDE.md](../../CLAUDE.md) come first. This guide covers how to apply them. It grows with each milestone.

## Core functions

- Business logic lives in `packages/core`, never in a page, action or route handler (NFR-ARCH-1).
- A core function takes the actor context first, and optionally a transaction handle (NFR-ARCH-5). It never reads env or touches `Request`.
- Inputs and outputs are Zod schemas (NFR-ARCH-2). Errors are `DomainError` with a stable `code` (NFR-ARCH-6).
- Check permissions in core, even when the page already did (FR-ROLE-3).
- Take time from `ctx.clock`, never `new Date()`, so tests can fix it.
- Start with `requirePermission(ctx, '…')`, then validate input, then read and write.
- Record what changed with `recordAudit(tx, …)` in the same transaction, with an allow-listed `details` object: never secrets or tokens. Add the event name to `AUDIT_ACTIONS` and its label to both message files; a test checks the labels.
- A change to an organization that must land in its twin too (memberships, its settings) runs in one `withSystem` transaction after the permission check, writes both tenants, and records the event in the real organization's log (ADR-010).
- Functions for the platform operator take a `PlatformActor`, not `ActorContext`, and read across tenants only through `withSystem`.

## Database access

- Go through `withTenant(ctx, fn)` or `withSystem(reason, fn)`. The reason is a sentence a reviewer can judge, such as `'daily billing run'`. `withUser` is only for the user's own memberships and organizations (ADR-010).
- Drizzle wraps Postgres errors: the SQLSTATE and constraint are on `error.cause`.
- Use Drizzle or `sql` parameters. Never build SQL from strings.
- Money and quantities are `numeric` in the database and a decimal library in code.
- No hard deletes: use a status or `active`.

## Adding a table

1. Add it to the Drizzle schema in `packages/db/src/schema/`, with `tenant_id` if a tenant owns it and `uuidv7()` as the key default.
2. Run `pnpm db:generate`, and review the SQL.
3. For a tenant-owned table, add `SELECT app_enable_tenant_rls('public.<table>'::regclass);` to the migration. The catalog test fails without it. A platform table (no tenant, written only by the migrate step or the super admin) gets `SELECT app_protect_platform_table('public.<table>'::regclass);` instead, which refuses writes outside system context.
4. A child table references its parent through `(tenant_id, id)`, so a row can't point into another tenant.
5. Give the isolation sweep (`tests/integration/isolation-sweep.test.ts`) data for the new table; it fails while any tenant table is empty.
6. A status or type column gets a CHECK generated from a TypeScript list with `oneOf` (CLAUDE.md rule 17).
7. Never edit a migration once merged. Write a new one.

Hand-written SQL (functions, triggers) goes in a custom migration: `pnpm --filter @comprobify/db exec drizzle-kit generate --custom --name=<name>`.

## Adding a feature key

1. Add the key and its kind (`BOOLEAN` or `LIMIT`) to `FEATURES` in `packages/core/src/entitlements/features.ts`. Never rename a key or change its kind; add a new one.
2. The migrate step syncs it to `features`. It grants nothing until the super admin puts it in a module, or a new starting module in `catalog.ts` carries it (seeded once, by key).
3. Enforce it in core: `requireFeature(ctx, key)` for a boolean, `requireWithinLimit(ctx.entitlements, key, used)` for a limit, where `used` is the count before the one being added. Pages use `hasFeature` only to hide or lock (FR-ROLE-3).
4. Give the error code a message in each form's error group that can raise it.

## Adding a job

1. Add the queue to `packages/core/src/jobs/registry.ts`: payload schema, options, concurrency.
2. Write the handler in `packages/core/src/jobs/handlers/`. Re-fetch by id, check state, then act, so a repeat run is harmless.
3. Register it in `registerHandlers`.
4. Enqueue it with `jobs.enqueue(tx, queue, data)` inside the transaction that makes the business change.
5. Run `pnpm db:migrate` so the queue exists.

A schedule goes in `schedules` in the same file, with its time zone.

## UI

- Components come from `@comprobify/ui/components/*`. Add new shadcn components from `packages/ui` with `pnpm dlx shadcn add`.
- Every string is in `apps/web/messages/es.json` and `en.json`, with the same keys. A test checks this.
- Use `Link` and `redirect` from `@/i18n/navigation`, so links keep the locale.
- A page inside the shell gets the actor from `loadShell(locale)`. If the role lacks the page's permission, render `<NoAccess />`; core refuses the actions anyway.
- Forms use `useFormAction` or `ActionForm`, never a form `action` prop, so an error keeps what was typed. Actions return `{ error: code }`, shown from a message namespace.
- An action that changes the organization or its mode calls `revalidatePath(`/${locale}`, 'layout')` before redirecting, so the shell's badge and banners update.
- Message keys never contain `.`; next-intl reads it as a path.
- Read the session through `getSession`, built on `currentHeaders()`, never `headers()` (CLAUDE.md, common mistake 27).

## Comments

Short, and about why, not what. One line is the norm.
