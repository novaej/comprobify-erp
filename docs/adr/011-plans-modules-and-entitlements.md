# ADR-011: Plans, Modules and Entitlements

## Status
Accepted

## Date
2026-11-03

## Context

Every feature must be switchable per plan and per tenant (PRD goal 4, FR-PLAN-1). PRD open question 2 asked whether a tenant can buy single features on top of a plan or only whole plans, because add-ons mean a subscription holds several priced items.

The owner's answers:

- A plan always contains a minimum set of features for the system to work.
- Fixed plans are bought self-service. A tenant can add single modules to them.
- A personalized plan is negotiated: the operator picks its modules and limits, sets its price per company, and edits it when the company wants more or less.
- Plans, modules and what each module contains are edited later without a release.
- Some planned features aren't built yet (retención, liquidación de compra, the received-documents import, the public API). They must exist in the catalog without being sold.
- A plan for companies that invoice from their own ERP through the API, sold by document volume.

The old system had seven tiers, each a fixed set of limits and allowed document types, defined in code. Two lessons carry over:

- **Capabilities are upgrade triggers, not only volume.** Cheap entry tiers with nothing but a smaller quota gave tenants no reason to move up. Multi-branch and credit notes sitting above the entry tier did.
- **One owner per limit.** The old API published some limits it couldn't enforce (the web app's seat count), which needed a map of which system enforced which limit. Here one core enforces every limit, so that split disappears.

## Decision

**Three layers.**

| Layer | What | Lives in | Who sees it |
|---|---|---|---|
| Feature key | A boolean (`DOC_TYPE_04`, `INVENTORY`) or a limit (`USERS`, `DOCUMENT_QUOTA`) that core checks | Code: a registry in `entitlements`, synced to a `features` table by the migrate step | Developers |
| Module | A named set of feature keys, the unit that is sold | Data: `modules`, `module_features` | Customers |
| Plan | A set of modules plus a value for each limit | Data: `plans`, `plan_modules`, `plan_limits` | Customers |

- **A key may sit in several modules.** A tenant's booleans are the union of all its modules. `PROVIDERS` is in Compras and later in Retenciones, Liquidaciones and Comprobantes recibidos, so no module depends on another and the plan builder needs one rule only (below).
- **The base module, Facturación, is in every plan.** A plan without it can't be saved, and the personalized plan can't drop it.
- **A module has a status:** `AVAILABLE` or `COMING_SOON`. A coming-soon module can't be bought on its own. A plan may list it: the plan shows it as coming soon, and it grants nothing until it becomes available, so Empresa gets guías de remisión when they ship.
- **Only system context writes the catalog.** A statement trigger raises `42501` on any other write, because a refused RLS `UPDATE` matches no rows and succeeds silently. Feature keys are written by the migrate step only.
- **A plan has a status** (`DRAFT`, `PUBLISHED`, `RETIRED`) and a `self_service` flag. Personalizado is not self-service.

**What a tenant has.** A tenant holds one subscription to a plan, plus subscription items:

- `MODULE`: a module bought on top of a self-service plan, or picked by the operator for Personalizado.
- `LIMIT`: a limit value set by the operator for Personalizado, replacing the plan's.
- Extra seats and document packs are items too; their pricing arrives with billing (Milestone 8).

Milestone 2 creates the subscription and its items without payments, so the billing tables of Milestone 8 extend them instead of replacing them. Personalizado's negotiated price is a field on the subscription, set and edited by the operator.

**Resolution, per key:** tenant override, then subscription items, then the plan, then off (FR-PLAN-1). An override grants, revokes or sets a limit, and is the operator's tool for one-off exceptions. `null` is unlimited.

**Twins inherit by mirrored rows.** The subscription, its items and the overrides are mirrored into the twin in the same transaction, like memberships (ADR-010), so the twin's own RLS reads them and nothing crosses tenants at request time. The twin is never billed and never uses quota (FR-ONB-6a).

**Enforcement.** Entitlements are resolved once per request into the actor context (FR-PLAN-4). Core checks them with `requireFeature` and `requireWithinLimit` in the kernel, raising `FEATURE_NOT_ENABLED` and `LIMIT_REACHED`. The UI hides or locks what the tenant doesn't have, as an extra layer only (FR-ROLE-3). Checks don't care whether a request came from the screens or, later, the API.

**Losing a module.** Existing data stays readable; creating or changing it is refused. A document type already active on an issue point keeps working (FR-PLAN-3).

**Editing a published plan or module.**

- An addition reaches every tenant on it immediately.
- A removal is dated at least 30 days ahead, like a price change (FR-BILL-6). A tenant keeps a module while it is in the plan now or was at the start of the tenant's current period, so the removal reaches each tenant at their first renewal after that date. The period is the subscription's own (ADR-028).

**Editing the catalog** (FR-ADM-3). The super admin edits modules and plans from the platform area:

- Module status only moves forward, from coming soon to available; going back would take a module from every company at once. Plans move draft → published → retired, and a retired plan can be published again. New modules start coming soon; new plans start as drafts with the base module and Gratis's limits.
- Adding a key to a module, adding a module to a plan or raising a limit is immediate. Removing a key or a module, or lowering a limit, is dated 30 days ahead, unless the module is coming soon or the plan is a draft, when nothing depends on it yet.
- A lowered limit keeps its current value and the new one with its date; a company gets the new value from its first period starting on or after that date. Raising it again cancels the lowering.
- Rows are never deleted: a removal is a date, and adding back before it cancels it.
- Every catalog change is recorded in `platform_audit_events`, the platform's own append-only log, since it reaches every company on a plan rather than one.

**Starting catalog.** Limits are placeholders until prices are set in Milestone 8.

| Module | Keys | Status |
|---|---|---|
| Facturación (base) | `DOC_TYPE_01`, `CATALOG`, `CLIENTS`, `BUYER_EMAIL`, `DOCUMENT_VOID`, `REPORTS_BASIC` | Available |
| Notas de crédito | `DOC_TYPE_04` | Available |
| Guías de remisión | `DOC_TYPE_06` | Coming soon |
| Marca | `RIDE_LOGO`, `DOCUMENT_TEMPLATES` | Available |
| Inventario | `INVENTORY` | Available |
| Compras | `PURCHASE_ORDERS`, `PROVIDERS` | Available |
| Ventas | `SALE_ORDERS`, `RECEIVABLES` | Available |
| Facturación masiva | `BULK_INVOICING` | Available |
| Reportes avanzados | `REPORTS_ADVANCED` | Available |
| Retenciones | `DOC_TYPE_07`, `PROVIDERS` | Coming soon |
| Liquidaciones de compra | `DOC_TYPE_03`, `PROVIDERS` | Coming soon |
| Comprobantes recibidos | `RECEIVED_DOCS_IMPORT`, `PROVIDERS` | Coming soon |
| Integración API | `API_ACCESS`, `API_KEYS`, `WEBHOOKS` | Coming soon |
| Asistentes IA | `MCP_READ`, `MCP_WRITE` | Coming soon |

"Available" means sellable once its milestone ships; until then the key gates nothing.

| Plan | Modules | Documents/month | Users | Branches / issue points per branch |
|---|---|---|---|---|
| Gratis | Base | 5 | 1 | 1 / 1 |
| Emprende | + Notas de crédito, Marca | 50 | 2 | 1 / 1 |
| Negocio | + Inventario, Compras, Ventas | 300 | 5 | 3 / 2 |
| Empresa | + Guías de remisión, Facturación masiva, Reportes avanzados | 2,000 | 10 | Unlimited |
| Integración 500 / 2,000 / 10,000 | Base, Notas de crédito, Integración API | 500 / 2,000 / 10,000 | 3 | 3 / 5 |
| Personalizado | Base + operator's choice | Operator's choice | | |

- **Gratis** is where a new company starts and where an expired subscription lands.
- **The Integración plans** are for companies that invoice from their own ERP. They still use the web app for onboarding, the certificate, users, billing and their documents. They stay coming soon until the API ships after the MVP.
- **New limit keys** with the API: `API_KEYS_MAX`, `WEBHOOK_ENDPOINTS_MAX`, `API_RATE_LIMIT`.

**Complimentary subscriptions.** A subscription is `PAID` or `COMPLIMENTARY`. Only the operator sets complimentary, with a reason, and it is recorded in the activity log. A complimentary subscription is a normal subscription to any plan, usually Personalizado, so the tenant's plan page and entitlements work as usual, but:

- It is never charged, never renews, never goes past due and never expires.
- Its document quota renews every month from the day its period started (ADR-028).
- It is left out of revenue figures.

The owner's company, which invoices through Comprobify itself (FR-BILL-4), runs on one, so the operator's own invoicing never depends on a payment. It also serves demos and partners. At cutover the owner's company gets it, and migrated documents don't use quota.

## Consequences

### Positive
- A new plan, a regrouping or a negotiated plan is data, edited from the admin area. Only a new feature key needs a release.
- Add-ons, Personalizado and fixed plans use one mechanism: subscription items.
- Unbuilt features are in the catalog from the start, so turning them on is a status change.

### Negative
- Resolution has four sources and a dated rule for removals, so it needs thorough unit tests (PRD 14).
- Mirroring the subscription into the twin adds writes to every subscription change, and the isolation sweep must cover the new tables.
- Prices per module for self-service add-ons wait for Milestone 8; until then an add-on can only be set by the operator.

## Alternatives considered

- **Whole plans only.** Simplest billing, but it can't express Personalizado or a single add-on, and the owner wants both.
- **Features sold one by one, without modules.** Too fine for customers and for pricing. A module groups what is bought together, and moving a key between modules is a data edit.
- **Dependencies between modules** (Compras requires Proveedores). Putting a key in every module that needs it removes the dependency graph and its validation.
- **The owner's company on overrides alone.** It would show no real plan, and every billing job would need a special case for it. A complimentary subscription is an ordinary subscription that billing skips by status.
- **Personalizado as a new plan row per company.** It would fill the plans table with one-off rows and duplicate every module edit. Items on the company's own subscription keep plans generic.
- **Resolving a twin's entitlements through its real organization at request time.** It needs a cross-tenant read on every request, which RLS forbids outside system context. Mirroring is the pattern memberships already use.
