# Architecture Decision Records

An ADR records a decision that is hard to reverse or not obvious from the code: its context, the choice, and the consequences. Write one when choosing between viable approaches, setting a pattern, or deciding not to do something that looks useful. Skip it for easily reversed details and routine fixes.

Status is `Proposed`, `Accepted`, `Deprecated` or `Superseded by ADR-XXX`. Accepted ADRs are not rewritten; a new ADR supersedes them.

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
| [017](017-delivery-guides.md) | Delivery guides | Accepted |
| [018](018-inventory-ledger-and-costing.md) | The inventory ledger and weighted average cost | Accepted |
| [019](019-purchase-orders.md) | Purchase orders | Accepted |
| [020](020-documents-move-stock.md) | Invoices and credit notes move stock | Accepted |
| [021](021-sale-orders.md) | Sale orders | Accepted |
| [022](022-invoicing-sale-orders.md) | Invoicing a sale order | Accepted |
| [023](023-delivery-guides-of-a-sale-order.md) | The delivery guides of a sale order | Accepted |
| [024](024-receivables.md) | Receivables | Accepted |
| [025](025-master-data-at-go-live.md) | Copying master data at go-live | Accepted |
| [026](026-bulk-invoicing.md) | Bulk invoicing | Accepted |
| [027](027-prices-and-their-history.md) | Prices and their history | Accepted |
| [028](028-subscription-periods-and-the-quota.md) | Subscription periods and the quota | Accepted |
| [029](029-payments-and-their-review.md) | Payments and their review | Accepted |
| [030](030-plan-changes-seats-and-add-ons.md) | Plan changes, seats and add-ons | Accepted |
| [031](031-document-packs-and-the-write-block.md) | Document packs and the write block | Accepted |
| [032](032-the-renewal-cycle.md) | The renewal cycle | Accepted |
| [033](033-card-payments-through-payphone.md) | Card payments through Payphone | Accepted |
| [034](034-the-iva-rate-and-its-history.md) | The IVA rate and its history | Accepted |
| [035](035-personalizado-billing-and-complimentary-add-ons.md) | Personalizado billing and complimentary add-ons | Accepted |
| [036](036-the-notification-centre.md) | The notification centre | Accepted |
| [037](037-email-templates-in-the-database.md) | Email templates in the database | Accepted |
| [038](038-retention-of-technical-duplicates.md) | Retention of technical duplicates | Accepted |
| [039](039-numbering-set-where-it-is-used.md) | Numbering, set where it is used | Accepted |
