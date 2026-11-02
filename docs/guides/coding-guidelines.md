# Coding Guidelines

The rules in [CLAUDE.md](../../CLAUDE.md) come first. This guide covers how to apply them. It grows with each milestone.

## Core functions

- Business logic lives in `packages/core`, never in a page, action or route handler (NFR-ARCH-1).
- A core function takes the actor context first, and optionally a transaction handle (NFR-ARCH-5). It never reads env or touches `Request`.
- Inputs and outputs are Zod schemas (NFR-ARCH-2). Errors are `DomainError` with a stable `code` (NFR-ARCH-6).
- Check permissions in core, even when the page already did (FR-ROLE-3).
- Take time from `ctx.clock`, never `new Date()`, so tests can fix it.

## Database access

- Go through `withTenant(ctx, fn)` or `withSystem(reason, fn)`. The reason is a sentence a reviewer can judge, such as `'daily billing run'`.
- Use Drizzle or `sql` parameters. Never build SQL from strings.
- Money and quantities are `numeric` in the database and a decimal library in code.
- No hard deletes: use a status or `active`.

## Adding a table

1. Add it to the Drizzle schema in `packages/db/src/schema/`, with `tenant_id` if a tenant owns it and `uuidv7()` as the key default.
2. Run `pnpm db:generate`, and review the SQL.
3. For a tenant-owned table, add `SELECT app_enable_tenant_rls('public.<table>'::regclass);` to the migration. The catalog test fails without it.
4. Never edit a migration once merged. Write a new one.

Hand-written SQL (functions, triggers) goes in a custom migration: `pnpm --filter @comprobify/db exec drizzle-kit generate --custom --name=<name>`.

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

## Comments

Short, and about why, not what. One line is the norm.
