# Architecture Decision Records

An ADR records a decision that is hard to reverse or not obvious from the code: its context, the choice, and the consequences. Write one when choosing between viable approaches, setting a pattern, or deciding not to do something that looks useful. Skip it for easily reversed details and routine fixes.

Status is `Proposed`, `Accepted`, `Deprecated` or `Superseded by ADR-XXX`. Accepted ADRs are not rewritten; a new ADR supersedes them. Numbers are independent of the old repositories, so write old ones as `API ADR-038`.

## Template

```markdown
# ADR-XXX: Title

## Status
## Date
## Context
## Decision
## Consequences
## Alternatives considered
```

## Index

| ADR | Title | Status |
|---|---|---|
| [001](001-one-app-monorepo.md) | One app, one worker, one image, pnpm monorepo | Accepted |
| [002](002-language-runtime-versions.md) | TypeScript, Node 24, exact version pinning | Accepted |
| [003](003-database-access-and-migrations.md) | PostgreSQL 18, Drizzle, SQL migrations, two roles | Accepted |
| [004](004-fail-loud-rls.md) | Fail-loud Row-Level Security | Accepted |
| [005](005-jobs-pg-boss.md) | Jobs and schedules on pg-boss | Accepted |
| [006](006-web-design-system-i18n.md) | Next.js, ported design system, next-intl | Accepted |
| [007](007-testing-and-code-quality.md) | Testing and code quality tooling | Accepted |
| [008](008-config-and-observability.md) | Config validation, logging, Sentry | Accepted |
| [009](009-authentication.md) | Authentication with Better Auth | Accepted |
| [010](010-tenancy-and-user-context.md) | Tenancy model and the user context | Accepted |
| [011](011-plans-modules-and-entitlements.md) | Plans, modules and entitlements | Accepted |
| [012](012-money-and-sri-catalogues.md) | Money arithmetic and SRI catalogues | Accepted |
| [013](013-sri-xml-xsd-and-signature.md) | SRI XML, XSD validation and the XAdES-BES signature | Accepted |
| [014](014-sri-client-and-mock.md) | The SRI client and the mock SRI | Accepted |
| [015](015-ride-and-buyer-email.md) | The RIDE and the buyer's copy | Accepted |
| [016](016-credit-notes-and-the-balance.md) | Credit notes and the balance of an invoice | Accepted |

## Old ADRs to read before each milestone

Port the ones still valid as "carried over" ADRs here, linking the original in `../comprobify/docs/adr/`.

| Milestone | API ADRs |
|---|---|
| 0 | 012, 020, 036, 037, 038, 039 |
| 1 | 018, 035 (what to leave behind) |
| 2 | 029, 031, 034 |
| 3 | 003, 004 (carried over as 013), 006, 008, 009 |
| 8 | 017, 022, 023, 025, 027, 028, 032, 033 |
| 9 | 024 |
| When Redis is added | 026 |
