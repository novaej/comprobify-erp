# ADR-010: Tenancy Model and the User Context

## Status
Accepted

## Date
2026-11-02

## Context

Milestone 1 adds tenants, their test twins, branches, issue points, warehouses and memberships (PRD 7.4, section 8). ADR-004 gives one RLS context, the tenant, and makes a query without it raise.

Two reads happen before a tenant is chosen, on every page that shows the organization switcher (FR-USR-5):

1. Which organizations does this user belong to?
2. What are those organizations' names and modes?

They can't run in a tenant context, because the answer spans tenants. The options:

- **System context** for these reads. It works, but `withSystem` logs every call by design, the switcher renders on every page, and nothing in the database stops that code from reading any tenant's memberships.
- **Global tables** for `tenants` and `memberships`, without RLS. Simple, but the tenant row holds the RUC, names and address, and a mistaken query would leak them silently.
- **A second, narrower context: the user.** The database itself limits these reads to the signed-in user's own organizations.

## Decision

**A user context, `app.user_id`, beside the tenant context.** `withUser(userId, fn)` in `packages/db` sets it per transaction, like `withTenant`. It is for identity lookups only: the organizations a user belongs to and their own memberships. Everything else stays tenant-scoped.

**Two policy shapes, both checked by the catalog test (NFR-SEC-5):**

| Shape | Used by | Rule |
|---|---|---|
| Tenant (ADR-004) | Every tenant-owned table | `app_is_system() OR tenant_id = app_require_tenant_id()` |
| Tenant or user | `memberships` only | `app_is_system() OR tenant_id = app_tenant_id() OR user_id = app_user_id()`, and it raises when none of the three contexts is set |

`tenants` has no `tenant_id` column: its row *is* the tenant. Its policy lets a session see the tenant in its context, and, in user context, the organizations the user has a membership in. It is written once in a migration and the catalog test checks it by name.

**Fail-loud stays.** A new `app_require_context()` raises `42501` when no tenant, user or system context is set, for the two tables that accept the user context.

**Twins:** a twin is another `tenants` row with `mode = TEST` and `twin_of` set (PRD 7.4). Memberships are **mirrored as rows** in the twin, written in the same system-context transaction as the real organization's, so the twin's own RLS reads them like any tenant data (FR-ONB-6a). The switcher groups a real organization and its twin as one entry.

**The session carries the active tenant.** `sessions.active_tenant_id` is set by the switcher after core checks the membership. Each request builds the actor context (`tenantId`, `tenantMode`, permissions, issue points) from it, in the tenant context.

**Roles and permissions live in core** (FR-ROLE-1): a fixed map from each role to its permissions, as in the old web app, extended for the ERP modules. The database stores the role name with a CHECK generated from the same TypeScript list (CLAUDE.md rule 17).

**Platform administration is not tenant work** (FR-ADM-1 to FR-ADM-5). The super admin area serves the platform operator, not an organization:

- **Super admin is a flag on the user**, set by an operator script, never a tenant role and never needing a membership. The same user may also belong to organizations, as the owner does when invoicing through Comprobify itself (FR-BILL-4).
- **The admin area has no active tenant.** It lives under its own route group and layout, with no organization switcher and no tenant context. Leaving it doesn't change the session's active tenant.
- **Core admin functions take a `PlatformActor`** (`userId`, the super admin flag, `clock`) instead of `ActorContext`, and check the flag in core, not only in the page (FR-ROLE-3).
- **Data access:** reading across tenants (the tenant list, payments to review, overdue documents) goes through `withSystem(reason, …)`, so every operator access is logged with its reason (NFR-SEC-2). Platform tables (plans, prices, agreement and email templates, SRI catalogues, from Milestone 2 on) have no `tenant_id`, so tenant RLS doesn't apply to them. Writes to them go only through admin functions.
- **Viewing a tenant as its users see it** (FR-ADM-6) is a separate, read-only, audited mode, decided when it is built.

**Ambiente** is one pure function in core: `1` unless the tenant mode is `PRODUCTION` **and** `APP_ENV` is `production` (FR-ONB-6), tested for every deployment × mode cell.

## Consequences

### Positive
- The switcher and sign-in can't see organizations the user doesn't belong to, enforced by Postgres.
- Twins need no special case in RLS: mirrored rows are ordinary tenant data.
- System context stays rare and meaningful in the logs: tenant jobs and the operator's admin area.
- The operator's work can't accidentally run inside, or change, a customer's tenant context.

### Negative
- A second context means a second policy shape, and the catalog test must know both.
- Mirroring means two membership writes per change, which must stay in one transaction.
- `withUser` must not grow into a general-purpose context: only identity lookups use it.

## Alternatives considered

- **System context for the switcher:** logged on every page, and not limited by the database.
- **Global `tenants` and `memberships`:** a mistaken query would leak a tenant's identity with no error.
- **Resolving twin access through `twin_of` at query time:** a cross-tenant read on every twin request. Mirrored rows avoid it.
