# Comprobify ERP — Product Requirements Document

Status: draft v1, 2026-10-30. Owner: Jonathan Pillajo.

This document specifies a **new system, built from scratch in a new repository**, that replaces the current two-system setup (`comprobify` API + `comprobify-web`). It carries over everything those systems learned, but is designed **ERP-first**: one application, one codebase, one database, one droplet. The public integration API and the MCP server come after the ERP is complete, as a thin layer over the same core.

---

## 0. How to use this document (for the builder)

- Build in the order of section 15 (Delivery plan). Each milestone has acceptance gates; don't start the next one until the gates pass.
- The previous two systems (an API and a web app) were the knowledge source. What was worth keeping has been carried into this repository, adapted to TypeScript and this architecture (Appendix A); their two-system machinery was left behind (Appendix B). This repository stands alone: nothing in it depends on them.
  - SRI technical spec: Ficha Técnica, esquema offline, v2.34 (July 2026). The owner has the PDF; ask for it before implementing a new document type.
- When this document is silent, decide, and record the decision and its reasons in an ADR.
- Every requirement has an id (`FR-…`, `NFR-…`). Reference ids in commits, tests and ADRs.
- Write `CLAUDE.md` for the new repo in the first milestone (section 13) and keep it current; it is the primary guide for every later session.

---

## 1. Summary

Comprobify is a cloud ERP for small and medium Ecuadorian businesses, built around SRI electronic invoicing. A business registers once with its RUC and electronic signature (P12), sets up its branches and issue points, and then runs its daily operation in one place: products and stock, clients and providers, purchase orders, sale orders, invoices and the other SRI documents, payments of its own subscription, and reports.

The current product is an invoicing API with a web UI on top. The new product is an ERP whose invoicing engine is one of its modules. Selling the engine to third parties (public REST API, webhooks, MCP for AI assistants) comes after the ERP is complete.

## 2. Goals and non-goals

### Goals (MVP)
1. One system: one Next.js application plus one background worker, sharing one TypeScript domain core and one Postgres database.
2. The full ERP flow: catalogue → purchases → stock → sale orders → invoices (partial, bulk) → SRI authorization → buyer email, with the SRI side as robust as today's (retries, re-issue, correction, verification).
3. SRI document types factura (01), nota de crédito (04) and guía de remisión (06). Comprobante de retención (07), liquidación de compra (03) and the import of received documents (XML) come after the MVP, but are in the plan catalog from the start (ADR-011).
4. Every feature switchable per plan and per tenant (entitlements) from day one.
5. Subscription billing (bank transfer with proof, card via Payphone, document packs) as today.
6. The same look and feel as the current web app (design tokens, components, layout, Spanish-first i18n).
7. Documentation for developers, operators and end users from the first milestone.

### Non-goals (MVP)
- Public REST API for integrators, tenant-managed API keys, outbound webhooks, MCP server, OAuth authorization server. **Designed for, built after** (section 5.14).
- Accounting (general ledger, chart of accounts, financial statements), payroll, multi-currency, multi-company consolidation, POS hardware, e-commerce connectors, mobile apps (the web app is mobile-responsive).
- Nota de débito (05): not requested yet; the document-type framework must make it a small addition.

## 3. Users and roles

| Persona | Description |
|---|---|
| Owner | Registers the business; full access including billing, users, promotion to production. |
| Admin | Everything except ownership transfer and promotion. |
| Sales operator (`BillingOperator` today) | Sale orders, invoices, credit notes, guías, clients, catalogue. |
| Purchasing / warehouse | Providers, purchase orders, receiving, stock adjustments, retenciones, liquidaciones. New role. |
| Viewer | Read-only. |
| Accountant | Read-only plus exports and reports. New role, external accountants are common in Ecuador. |
| Super admin | Platform operator (Comprobify staff): tenants, payments review, prices, agreements, templates, feature overrides, jobs. |

- **FR-ROLE-1** Roles map to a fixed permission set (`ROLE_PERMISSIONS`, carried over from the previous web app and extended for ERP modules). Custom roles are post-MVP.
- **FR-ROLE-2** A user can be restricted to specific issue points (`UserIssuerAccess` today). Restrictions apply to every query and action, enforced server-side.
- **FR-ROLE-3** Permissions are enforced in three layers: page, server action/route, and service (core). The core layer is the one that must never be skipped, because the public API will call it later.

## 4. Glossary

| Term | Meaning |
|---|---|
| Tenant / organization | One business, one RUC. Root of all data and billing. |
| Branch (establecimiento) | 3-digit code (`001`). Has an address. One warehouse per branch in the MVP. |
| Issue point (punto de emisión) | 3-digit code within a branch (`001`). Owns the sequential counters. In the old code, an "issuer" row = branch + issue point. |
| Sequential | 9-digit document number per issue point, per document type, per environment. |
| Access key (clave de acceso) | 49 digits: date, doc type, RUC, environment, series, sequential, numeric code, emission type, Module 11 check digit. |
| Deployment environment (`APP_ENV`) | Which servers and database: `local`, `staging`, `production`. Each deployment has its own database. No real customer works outside `production`. |
| Tenant mode | `TEST` or `PRODUCTION`: which SRI environment a company's documents go to. Exists inside every deployment. See 7.4. |
| Test organization (twin) | The `TEST`-mode copy of a tenant: another row in `tenants`, linked by `twin_of`, isolated by the normal tenant RLS. |
| Master data | The records a business sets up once and reuses: products and services, clients, providers, warehouses, document templates. As opposed to transactions (orders, invoices, stock movements, payments), which are created by daily operation. |
| Twin reset | Deleting all of a test twin's data (transactions and master data) and re-creating it as a fresh copy: branches and issue points from the real organization, master data copied from it, sequentials back to 1. The real organization is never touched. Owner or Admin only, with a confirmation. The one allowed exception to "no hard deletes": the reset function refuses to run unless the tenant's mode is `TEST`. |
| Ambiente | The SRI environment digit in the access key and XML: `1` test, `2` production. Derived from tenant mode and deployment (7.4). |
| RIDE | The printable PDF representation of an authorized document. |
| Consumidor final | Anonymous buyer, id `9999999999999`, idType `07`. |
| Entitlement | A feature (boolean) or limit a plan grants, overridable per tenant. |

---

## 5. Functional requirements

### 5.1 Registration, onboarding, environments

- **FR-ONB-1** Sign-up with email + password; email verification with a non-consuming check (`GET`) and a consuming confirm (`POST`), because email link scanners prefetch links (lesson from the API's Common Mistake #42).
- **FR-ONB-2** Onboarding wizard: RUC, legal name, trade name, main address, tax regime (general, RIMPE emprendedor or RIMPE negocio popular, which decides the Anexo 22 legend) and whether it must keep accounts, P12 upload + password, first branch and issue point (address defaults to the main address), optional logo (PNG/JPEG/GIF ≤ 500 KB).
- **FR-ONB-3** P12 handling: parse, validate expiry and that the certificate matches the RUC, store the private key **AES-256-GCM encrypted** (key from env), certificate PEM in clear, fingerprint and expiry. Decrypt only at signing time. Renewal flow; certificate-change events in the audit log. The certificate is stored on both the real organization and its test twin (a row per tenant, since RLS forbids cross-tenant references); upload and renewal write both in one system-context transaction.
- **FR-ONB-4** Registration creates **two organizations**: the real one (`mode = PRODUCTION`, not yet able to issue) and its test twin (`mode = TEST`, `twin_of` = the real one), each with the same branches and issue points. The user lands in the test twin and can issue test documents right away. Unique key on (`ruc`, `mode`).
- **FR-ONB-5** **Going live** (Owner only; requires email verified and legal agreements accepted when enabled) enables issuing on the real organization and seeds its sequentials (optionally with starting numbers for businesses migrating from another provider). It offers to copy master data from the twin: products, clients, providers, templates (never transactions). One-way per organization; the twin stays available afterwards for testing new document types or flows, and can be reset by an Owner or Admin (see "Twin reset" in the glossary; a typed confirmation, logged in the audit log). Data moves between the two in exactly two ways (decided): test → real once, at go-live (master data only); real → test through a reset (full refresh). No selective copy in either direction; nothing ever flows from the twin into the real organization after go-live.
- **FR-ONB-6** **Ambiente rule:** a document's ambiente is `1` when the tenant's mode is `TEST` **or** `APP_ENV != production` (safety rail); `2` only for a `PRODUCTION`-mode tenant on the production deployment. Computed in one function, used by builder, access key and SRI client. `SRI_MOCK_MODE` (non-production deployments only, re-checked at every call) fakes SRI responses for demos.
- **FR-ONB-6a** The twin inherits the real organization's plan and features (entitlements resolve through `twin_of`), never consumes document quota, and isn't billed. Memberships are mirrored: a user's role in the real organization applies to its twin.
- **FR-ONB-7** Account recovery is plain password reset (email token). No P12-based recovery: it existed only because the old API had no users.
- **FR-ONB-8** Legal documents (Terms, Privacy, DPA): versioned Markdown templates, per-tenant personalized immutable snapshots, acceptance with IP/user agent, re-acceptance on new versions, global on/off switch (`AGREEMENTS_ENABLED`). Port from ADR-018.

### 5.2 Users, sessions, security

- **FR-USR-1** Invite users by email (token, set password), change role, remove (soft). Seat limit from entitlements (`USERS`), extra seats purchasable.
- **FR-USR-2** Database-backed sessions (revocable), per-tenant idle timeout, absolute lifetime, "sign out everywhere". Learn from the previous web app's idle-timeout bug: only real user activity extends a session, not background polling.
- **FR-USR-3** Optional TOTP 2FA per user; tenants can require it.
- **FR-USR-4** Rate limits and repeated-attempt detection on login, reset, verification and invite endpoints.
- **FR-USR-5** Organization switcher for a user who belongs to several tenants (accountants). A real organization and its twin appear as one entry with a Producción / Pruebas toggle; the sandbox banner is shown whenever the active organization is a twin.

### 5.3 Plans, entitlements, subscription billing

- **FR-PLAN-1** Three layers (ADR-011). **Feature keys** (`key`, `kind` boolean|limit) are in code and synced to a `features` table. **Modules** (`modules`, `module_features`) are named sets of keys and the unit that is sold; a key may sit in several modules, and a module is `AVAILABLE` or `COMING_SOON` (not sellable). **Plans** (`plans`, `plan_modules`, `plan_limits`, `null` = unlimited) are modules plus limit values, with a status (`DRAFT`, `PUBLISHED`, `RETIRED`) and a `self_service` flag. Plans and modules are data, edited by the super admin. Every plan contains the base module, Facturación.
- **FR-PLAN-1a** A tenant holds one subscription to a plan plus items: `MODULE` (an add-on on a self-service plan, or the operator's pick for Personalizado), `LIMIT` (Personalizado's limit values), and from Milestone 8 extra seats and document packs. Personalizado is not self-service: the operator sets its modules, limits and a negotiated price per company, and edits them later. Resolution per key: tenant override → subscription items → plan → off. The subscription, items and overrides are mirrored into the twin.
- **FR-PLAN-1b** A subscription is `PAID` or `COMPLIMENTARY`. Complimentary is set by the operator with a reason: never charged, never renews, never expires, left out of revenue. The owner's own company runs on one.
- **FR-PLAN-2** Every feature is a key, including the ones that are "free for everyone" today. Starting catalog and plans in ADR-011. Keys (extend as modules are added):
  - Limits: `DOCUMENT_QUOTA`, `MAX_BRANCHES`, `MAX_ISSUE_POINTS_PER_BRANCH`, `USERS`.
  - Document types: `DOC_TYPE_01`, `DOC_TYPE_04`, `DOC_TYPE_06`; coming soon: `DOC_TYPE_07`, `DOC_TYPE_03`, `RECEIVED_DOCS_IMPORT`.
  - ERP: `CATALOG`, `CLIENTS`, `PROVIDERS`, `INVENTORY`, `MULTI_WAREHOUSE` (post-MVP), `PURCHASE_ORDERS`, `SALE_ORDERS`, `RECEIVABLES`, `BULK_INVOICING`, `REPORTS_BASIC`, `REPORTS_ADVANCED`, `DOCUMENT_TEMPLATES`.
  - Other: `BUYER_EMAIL`, `RIDE_LOGO`, `DOCUMENT_VOID`, `EXTRA_SEATS`, `DOCUMENT_PACKS`.
  - Coming soon (post-MVP): `API_ACCESS`, `API_KEYS`, `WEBHOOKS`, `MCP_READ`, `MCP_WRITE`, and the limits `API_KEYS_MAX`, `WEBHOOK_ENDPOINTS_MAX`, `API_RATE_LIMIT`.
- **FR-PLAN-3** Losing a document-type feature only blocks enabling it on an issue point; an already-active type keeps working (grandfathering). Losing any other module keeps its data readable and refuses changes. Removing a module from a published plan is dated at least 30 days ahead and reaches each tenant at their next renewal; additions apply immediately.
- **FR-PLAN-4** Entitlements are resolved once per request and cached in the request context; the UI hides or locks what the tenant doesn't have, and the core enforces it (`FEATURE_NOT_ENABLED`).
- **FR-BILL-1** Subscriptions: plan + interval (monthly/yearly, yearly = 10× monthly), period start/end, statuses `PENDING_PAYMENT`, `ACTIVE`, `CANCELLED`, `EXPIRED`. Port ADR-017, 023, 025, 027, 029, 032, 033 rules.
- **FR-BILL-2** Payments: purposes `INITIAL`, `RENEWAL`, `TIER_CHANGE`, `SEAT_CHANGE`, `DOCUMENT_PACK`; amounts stored as base + IVA (the rate in force on the day, from a dated table with its history, snapshot on the payment; ADR-034) + total; short hand-typable payment code; pricing breakdown JSON for prorated changes.
- **FR-BILL-3** Payment methods: SPI bank transfer with proof upload (1–5 files per submission, ≤ 10 active, soft delete, operator review with reason codes) and Payphone card (session, confirm on return page within 5 minutes, reconciliation sweep, duplicate-charge detection). Port `payphone-payment.service.js` behaviour exactly; every guard there came from a real incident.
- **FR-BILL-4** A verified payment grants access immediately; the operator's self-billed invoice is a work queue ("Facturas pendientes"), not a gate (ADR-027). The operator invoices through Comprobify itself (dogfooding).
- **FR-BILL-5** Upgrades prorated and immediate; downgrades and interval changes deferred to period end at full price; never a negative amount (no refunds-to-tenant mechanism). Renewal reminder 7 days before, past-due warning, expiry after 7-day grace → `PAST_DUE` status that blocks writes but lets the tenant pay.
- **FR-BILL-6** Price history: DRAFT → PUBLISHED with ≥ 30 days notice (mandatory notification, can't be muted); every charge resolves the price as of the date its period starts.
- **FR-BILL-7** Document quota per period (yearly plans pool 12× up front); periods aligned with the subscription period. Documents issued from a test twin never consume quota. When quota runs out, the tenant buys a **document pack** (`DOCUMENT_PACK` payment) instead of per-document overage. Pack sizes, prices, and expiry vs rollover: open question.
- **FR-BILL-8** Refund (operator): restore the pre-payment snapshot, never "downgrade to FREE" blindly.
- **FR-BILL-9** Suspension by the operator with a reason code (`PAYMENT_REVERSED`, `FRAUD_SUSPECTED`, `TERMS_VIOLATION`, `VOLUNTARY_CLOSURE`, `UNPAID_BALANCE`, `OTHER`); suspended tenants keep read access to their own data.

### 5.4 Master data

- **FR-MD-1 Products and services:** code (unique per tenant), auxiliary code, name, description, type (good/service), unit of measure, default price, cost, tax profile (IVA rate code, ICE if applicable), `tracksStock`, active flag, up to 3 additional details (SRI `detAdicional`). Import/export CSV.
- **FR-MD-2 Clients:** idType (04 RUC, 05 cédula, 06 passport, 07 consumidor final, 08 foreign id), id with validation (cédula/RUC check digits), name, email(s), phone, address, default payment terms. Consumidor final is a built-in pseudo-client.
- **FR-MD-3 Providers:** same identity shape as clients, plus payment terms and default retention codes.
- **FR-MD-4 Warehouses:** one per branch, created automatically with the branch. Every stock row carries `warehouse_id` so more warehouses per branch can be added later without a data migration.
- **FR-MD-5 Document templates:** saved invoice line sets for recurring billing (exists today in the web app).
- **FR-MD-6** SRI catalogues as typed lists in code, with CHECKs generated from them and labels in the message files (ADR-012): id types, document types, tax types, tax rates (IVA 0/5/12/15/exento/no objeto, with SRI codes), payment methods (formaPago), term units. Retention codes (renta and IVA), a long list that changes yearly, become a table when retenciones arrive.

### 5.5 Inventory

- **FR-INV-1** Append-only `stock_movements` ledger: product, warehouse, signed quantity, unit cost, type (`PURCHASE_RECEIPT`, `SALE`, `RESERVATION`, `RELEASE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `RETURN_IN` (credit note), `TRANSFER_OUT/IN` post-MVP, `OPENING_BALANCE`), source document reference, user, timestamp.
- **FR-INV-2** `stock_levels` (on hand, reserved, available) updated in the **same transaction** as the movement, locking the product/warehouse row (`SELECT … FOR UPDATE`). Never recompute levels by summing the ledger on the hot path; a nightly job verifies ledger = levels and alerts on drift.
- **FR-INV-3** Manual adjustments with reason; opening balances import (CSV).
- **FR-INV-4** Negative stock: configurable per tenant (block or allow with warning). Default: block.
- **FR-INV-5** Costing: weighted average cost, updated on each receipt. Stock valuation report.
- **FR-INV-6** Stock is only touched when the tenant has `INVENTORY` and the product `tracksStock`.

### 5.6 Purchases

- **FR-PUR-1 Purchase orders:** `DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED → CLOSED`, `CANCELLED` from DRAFT/SENT. Lines from the catalogue.
- **FR-PUR-2 Receiving:** full or partial per line, creating `PURCHASE_RECEIPT` movements and updating average cost.
- **FR-PUR-3** Email the PO to the provider as PDF (optional).
- **FR-PUR-4 Received documents import (post-MVP):** upload one or many authorized XMLs (SRI has no service to list received documents). Parse into provider (created if new) and a purchase record with lines; deduplicate by access key; can prefill a PO receipt and a retención. PDFs accepted only as attachments. Later: inbound email address per tenant.
- **FR-PUR-5 Retención (07, post-MVP):** generated from a received purchase/provider invoice; retention codes and percentages from the catalogue; sent to SRI like any document.
- **FR-PUR-6 Liquidación de compra (03, post-MVP):** for purchases from people without a RUC; creates the purchase and, when stock applies, the receipt.

### 5.7 Sales

- **FR-SAL-1 Sale orders:** `DRAFT → CONFIRMED → PARTIALLY_INVOICED → INVOICED`, `CANCELLED` from DRAFT/CONFIRMED (releases reservations). Lines only from the catalogue.
- **FR-SAL-2** Confirm reserves stock (`RESERVATION`); an **authorized** invoice converts its lines' reservation into `SALE`; cancel releases what is still reserved.
- **FR-SAL-3 Partial invoicing:** one order → many invoices; each invoice picks lines and quantities, never more than uninvoiced. Link table `sale_order_invoice_lines` (order line, document id, quantity). Payment method (formaPago, plazo) chosen at invoicing.
- **FR-SAL-4** An order is `INVOICED` when every line is fully covered by authorized invoices. A failed invoice stays attached and keeps covering its quantities: it is corrected, not replaced (5.8). Only a `VOIDED` invoice returns its quantities (and restores the reservation).
- **FR-SAL-5** Lines covered by an authorized or in-flight invoice can't be edited on the order; the path is a credit note.
- **FR-SAL-6** Order → invoice → stock happen in **one database transaction** (create the document row, link, reserve/adjust stock, consume quota, enqueue the SRI send). This is the main reason for the single database.
- **FR-SAL-7 Direct invoice** (without an order) stays available for plans without `SALE_ORDERS`, and for quick sales. Both paths call the same core function.
- **FR-SAL-8 Credit notes (04):** from an authorized invoice; quantities and amounts limited by the remaining balance (locked against concurrent creation, unlike today's accepted race); optional stock return (`RETURN_IN`). Buyer must be identified (no consumidor final). Reason required.
- **FR-SAL-9 Guía de remisión (06):** from an invoice or sale order, or standalone; transportista, plate, dates (start ≥ issue date, SRI error 82), departure address, recipients with optional supporting document. Consumes quota.
- **FR-SAL-10** Receivables (basic): invoice payment status (unpaid/partial/paid) recorded manually, aging report. Full collections management is post-MVP.

### 5.8 Electronic documents (the SRI engine)

This is the most rule-dense module. Section 6 lists the SRI rules it must follow.

- **FR-DOC-1 Types:** 01, 04, 06 in the MVP; 07 and 03 after it. A registry maps each type to its builder, XSD, validator, RIDE mapper and header label; adding a type = one entry plus those pieces (port `docs/guides/coding-guidelines.md` "Adding a new document type").
- **FR-DOC-2 Creation pipeline** (all inside one transaction, except signing which happens before commit):
  1. idempotency check (key + payload hash; same key + different payload → 409);
  2. entitlement and issue-point checks (`can_issue` pause flag, allowed types);
  3. quota consumption (production only);
  4. next sequential with `SELECT … FOR UPDATE`;
  5. access key (Module 11);
  6. build XML;
  7. **validate against XSD before signing**;
  8. sign XAdES-BES;
  9. persist document + lines + event; enqueue `SRI_SEND` in the same transaction.
- **FR-DOC-3 Status machine:** `SIGNED → PENDING_SEND → RECEIVED | RETURNED | SEND_FAILED`; `SEND_FAILED → RECEIVED | PENDING_SEND`; `RECEIVED → AUTHORIZED | NOT_AUTHORIZED`; `RETURNED | NOT_AUTHORIZED → SIGNED` (correction); `AUTHORIZED → VOIDED`. Enforced in code **and** by a DB trigger, both generated from one definition (avoid the old system's two hand-kept copies).
- **FR-DOC-4 Sending and retries (calendar in Ecuador time):**
  - 5 quick attempts ~5 minutes apart for transport errors only (network, HTTP 5xx, timeout). A clean SRI answer is never retried.
  - Then hourly retries until 23:59:59 of the issue day (`retry_until`), spread out to avoid hammering SRI.
  - Manual retry only on the issue day (`DOCUMENT_RETRY_WINDOW_CLOSED` otherwise).
  - After the deadline, one read-only SRI query: SRI has it → `RECEIVED`; not → `SEND_FAILED` (with a flag if SRI couldn't be asked).
  - Reception codes 70 (in processing) and 43 (key already registered) mean SRI holds the document → `RECEIVED`, never `RETURNED`.
- **FR-DOC-5 Authorization checks:** quick checks, then hourly for 3 days, then daily, **never capped**. Alert (in-app + operator) when a document has no final answer 24 hours after `RECEIVED` (SRI's maximum processing time).
- **FR-DOC-6 Re-issue:** on D+1 (Ecuador), each `SEND_FAILED` document from yesterday is re-checked and, if SRI still doesn't have it, rebuilt with today's date, a new access key and the **same sequential**, validated, signed and sent; the old key/date/XML go to `document_reissues` (reason `AUTO_NEXT_DAY`, `MANUAL`, `CORRECTED`); old keys still resolve. Month-crossing documents are skipped and the tenant is notified. From D+2, manual re-issue with a confirmation naming the new date. SRI error 45 (sequential registered) stops the process and alerts. Notification "Factura … re-emitida con fecha …".
- **FR-DOC-7 Correction** (replaces "rebuild"): from `RETURNED`, `NOT_AUTHORIZED` or `SEND_FAILED`, the user edits the source (sale order or invoice form prefilled with the document's data) and resends **the same document** (same row, same sequential; same key on the same day, re-dated with a new key after the day passed). Never a new document number.
- **FR-DOC-8 Void:** only from `AUTHORIZED`; refused for consumidor final; checks SRI's Consulta de validez service for `ANULADO`/`PENDIENTE DE ANULAR` before marking `VOIDED`; falls back to the user's attestation when the service is down. Voiding doesn't refund quota. Show the deadline (until the 7th of the following month; verify the resolution text).
- **FR-DOC-9 Validation rules:** issue date = today (Ecuador); consumidor final invoices ≤ `CONSUMER_FINAL_MAX_AMOUNT` (config, default 50 USD, verify legal amount); credit notes, debit notes and retenciones require an identified receptor; per-item additional details ≤ 3 and ≤ 300 chars, no tabs/newlines; document ≤ 320 KB.
- **FR-DOC-10 RIDE:** generated on demand from the **authorized XML**, never from live data (only the logo is live). A4 PDF with Code 128 barcode. Port `helpers/ride-builder.js` and `ride.service.js` mappers.
- **FR-DOC-11 Buyer email:** on authorization, email RIDE + XML to the buyer (`BUYER_EMAIL` feature), sender "`<business name>` via Comprobify"; delivery tracking via Mailgun webhook (delivered, failed, complained); manual resend.
- **FR-DOC-12 Document views:** list with filters (status incl. `SEND_FAILED`, type, issue point, dates, client, amount), detail with timeline (events, SRI responses, re-issues), RIDE preview, XML download, "documentos pendientes" screen grouping everything not yet final.
- **FR-DOC-13 Audit:** every transition writes a document event; SRI raw responses stored (not shown to users).

### 5.9 Bulk invoicing

- **FR-BULK-1** Select many confirmed sale orders (or upload a CSV of invoices) → one batch. Any size; items past the quota fail individually with `QUOTA_EXCEEDED`, the rest continue.
- **FR-BULK-2** Items processed one by one by the worker (create → send → authorize), with per-item status `QUEUED`, `CREATING`, `SENT`, `AUTHORIZED`, `FAILED` (reason).
- **FR-BULK-3** "Stack" view: live progress bar, per-item status, retry failed items, links to documents. `BATCH_COMPLETED` notification.
- **FR-BULK-4** Pacing: a per-tenant and global concurrency limit towards SRI, so one large batch doesn't delay other tenants' single invoices (fair queuing).

### 5.10 Notifications and audit

- **FR-NOT-1** In-app notifications with per-user read state; email channel per type; per-user preferences per (type, channel); mandatory types can't be muted (price change notice).
- **FR-NOT-2** Types: document authorized (aggregated per minute), document rejected, send failed / re-issued, authorization overdue (24 h), certificate expiring (30/15/7 days) / expired, quota warning (80 %, 100 %), payment verified/rejected, renewal due, past-due warning, subscription expired, price change, batch completed, stock below minimum (post-MVP).
- **FR-NOT-3** Email templates versioned in the database (subject, HTML, text, per language), editable by super admin; render falls back to Spanish.
- **FR-NOT-4** Tenant audit log (who did what, when): logins, user changes, settings, certificate changes, promotions, billing events, voids, stock adjustments.

### 5.11 Dashboard and reports

- **FR-REP-1** Dashboard: sales today/month, documents by status (highlighting pending and failed), quota used, top products, low stock, certificate expiry.
- **FR-REP-2** Reports (CSV/XLSX export): sales by period/client/product, documents issued, tax summary (IVA by rate, retenciones issued/received) useful for the monthly declaration, stock valuation, stock movements, purchases by provider, receivables aging.
- **FR-REP-3** Accountant export: all authorized XMLs for a month as a ZIP.

### 5.12 Platform administration (super admin)

- **FR-ADM-1** Tenants: list/search, status, plan and add-ons, Personalizado modules/limits/price, complimentary with reason, quota, feature overrides, verify email, promote, suspend/reactivate with reason, event log.
- **FR-ADM-2** Payments review with proof viewer, verify/reject/refund; invoicing queue; Payphone reconciliation view.
- **FR-ADM-3** Prices (plans, modules, seats, packs) draft/publish; plans and modules editor (contents, status).
- **FR-ADM-4** Legal agreements and email templates editor/publisher.
- **FR-ADM-5** Jobs view: last run, outcome, failed jobs with retry; documents overdue at SRI across tenants.
- **FR-ADM-6** Impersonation (read-only "view as tenant") with audit entry; post-MVP if time is short.

### 5.13 Internationalization and UX

- **FR-UX-1** Spanish default, English secondary; every string in message files; dates and money in Ecuadorian format.
- **FR-UX-2** The design system carried over from the previous web app (`packages/ui`): Tailwind v4 tokens (light/dark, success/warning/info palettes, sidebar/panel tokens), shadcn/ui `base-nova` style on Base UI, lucide icons, sonner toasts, the sidebar layout (tenant badge, issue-point switcher, user menu, notification bell), status badges, sandbox banner, certificate banner.
- **FR-UX-3** Mobile-responsive everywhere (tables scroll horizontally, stacked forms).
- **FR-UX-4** Keyboard-friendly line entry for orders and invoices (product search by code/name, quantity, tab through).
- **FR-UX-5** Public marketing pages (landing, pricing from the plans table, support) in the same app.

### 5.14 Post-MVP: integration layer (design for it now)

Built after the ERP is complete, on top of the same core:
- Public REST API (`/v1/...`) with tenant API keys (hashed, scoped, per-key usage; test keys belong to the twin, live keys to the real organization, like Stripe's test/live keys), RFC 7807 errors, idempotency keys, tenant- and key-level rate limits (Redis-backed once there is more than one instance).
- Outbound webhooks (HMAC-signed, retries, delivery log), including `DOCUMENT_REISSUED`.
- Batches endpoint, `externalReference` on documents.
- MCP server for AI assistants (read first, then write with preview → confirm), authenticated through the app's OAuth.
- Public developer docs (es/en), rewritten from the previous API's documentation site. Not started until this phase.

**Design constraints so this is cheap later (MVP must respect them):**
- **NFR-ARCH-1** All business logic lives in `packages/core`, callable with an explicit actor context `{ tenantId, tenantMode, userId | apiKeyId, permissions, issuePointIds }`. Server actions and route handlers are thin adapters. No business rule in a React component or server action.
- **NFR-ARCH-2** Core inputs/outputs are Zod schemas, reusable to generate the OpenAPI spec later.
- **NFR-ARCH-3** Documents accept an optional `externalReference` and idempotency key from day one.

---

## 6. SRI rules and lessons (must be preserved)

Verified against the Ficha Técnica v2.32 unless marked.

1. **Endpoints:** test `https://celcer.sri.gob.ec/comprobantes-electronicos-ws`, production `https://cel.sri.gob.ec/comprobantes-electronicos-ws` (reception `RecepcionComprobantesOffline`, authorization `AutorizacionComprobantesOffline`, Consulta de validez `ConsultaComprobante`). Configurable via env.
2. **Offline scheme:** send (RECIBIDA / DEVUELTA), then query authorization (AUTORIZADO / NO AUTORIZADO / in process). Authorization can take up to 24 hours.
3. **Reception codes:** 43 clave acceso registrada, 45 secuencial registrado, 65 fecha de emisión extemporánea, 70 clave en procesamiento (don't resend or re-issue for up to 24 h). 43 and 70 mean SRI holds the document.
4. A **rejected document is corrected and resent with the same key and sequential**. DEVUELTA documents are not stored by SRI. One key may have several NO AUTORIZADO answers and one AUTORIZADO.
5. Keep documents in **chronological and sequential order**, no duplicate sequentials or keys, avoid unnecessary resends.
6. **Issue date = transmission day** from 2026-01-01 (Res. NAC-DGERCGC25-00000017, verify text). All date decisions in **Ecuador time (UTC-5, no DST)**; servers run UTC.
7. **Access key:** `ddmmyyyy` + doc type (2) + RUC (13) + ambiente (1) + series (6) + sequential (9) + numeric code (8) + emission type `1` (1) + Module 11 check digit. Port `helpers/access-key-generator.js` with its tests.
8. **Signature:** XAdES-BES enveloped, RSA-SHA1/SHA-256 as SRI requires (port `helpers/signer.js`, ADR-004). Validate XSD with `xmllint` before signing (ADR-003). XSDs: factura 2.1.0, nota de crédito 1.1.0, plus guía, retención, liquidación (get from the ficha's annexes).
9. **Sequentials:** `SELECT … FOR UPDATE` inside the creating transaction; per issue point and type (the twin has its own counters because they are its own rows); can only move forward (manual set for migrations).
10. **Consumidor final** `9999999999999` / idType 07: amount cap (config); not allowed on credit notes, debit notes, retenciones; consumidor-final invoices can't be voided (2026 rule, verify).
11. **Voiding** happens on SRI's portal (no SOAP cancel); deadline until the 7th of the following month (verify).
12. **Two addresses** on every document: main (`dirMatriz`) and branch (`dirEstablecimiento`), both always present.
13. **Element order matters** for XSD validation (e.g. `detallesAdicionales` between `precioTotalSinImpuesto` and `impuestos`).
14. Line tax amounts are computed from `rate`, never from a non-existent field (old bug produced `NaN` in the DB).
15. The RIDE is a frozen representation of the authorized XML (old bug: RIDE drifted after builder fixes).
16. "RUC Proveedor" (software provider) printed as a campo adicional from `OPERATOR_RUC`. Required by Anexo 26 of v2.34 (resolution NAC-DGERCGC26-00000027), so `OPERATOR_RUC` is mandatory in production.
17. Error 33 ("IP sancionada") is not in v2.32; still pace sends.
18. Open: chronological-order trade-off when re-issuing across a month boundary (accountant), legal consumidor-final cap, resolutions 14/17 texts.

---

## 7. Architecture

### 7.1 Overview

```
                    ┌──────────────── one droplet (Docker Compose) ───────────────┐
 Browser ──HTTPS──► │ Caddy ─► web (Next.js: UI, server actions, route handlers)  │
                    │                    │ calls                                   │
                    │             packages/core (domain modules, TypeScript)      │
                    │                    │                                         │
                    │ worker (Node) ─────┘  jobs: SRI send/authorize, emails,      │
                    │                       re-issue, batches, schedules           │
                    └──────────────────────────────┬──────────────────────────────┘
                                                   │ TLS
                                    Managed PostgreSQL (one database)
                                    data + job queue (pg-boss) + sessions
 External: SRI SOAP · Mailgun · Payphone · Sentry · Betterstack · DO Spaces (backups/files)
```

- One codebase, two process roles from one Docker image: `web` and `worker`. Both use `packages/core`.
- No RabbitMQ, no Redis, no droplet cron in the MVP: the job queue and schedules live in Postgres (pg-boss). Enqueuing a job in the **same transaction** as the business write gives the outbox guarantee natively (the old system needed a separate `pending_effects` table plus a broker plus a reconciliation sweep for that).
- Redis is added only when there is more than one `web` instance (shared rate-limit counters) or the public API ships.

### 7.2 Repository layout (pnpm monorepo)

```
apps/
  web/            Next.js app (UI, server actions, route handlers, auth)
  worker/         job runner entry point (registers handlers from core)
packages/
  core/           domain modules; no Next.js imports
    identity/ tenancy/ entitlements/ billing/ catalog/ parties/ inventory/
    purchasing/ sales/ documents/ (sri/ builders/ signer/ ride/) batches/
    notifications/ reporting/ audit/ admin/
  db/             Drizzle schema, SQL migrations, RLS helpers, seeds
  ui/             shared shadcn components and design tokens (ported)
  config/         env parsing and validation (Zod), shared tsconfig/eslint
docs/             see section 13
infra/            terraform, compose files, Caddyfile, scripts
```

Module rules:
- **NFR-ARCH-4** Modules talk through their public functions (`core/<module>/index.ts`), never through each other's tables. Cross-module workflows (order → invoice → stock) are orchestrated in one service function that owns the transaction.
- **NFR-ARCH-5** Every core function takes the actor context first and a transaction handle optionally; it never reads `process.env` (config is injected), never touches `Request`/`Response`.
- **NFR-ARCH-6** Errors are typed (`DomainError` with a stable `code`); the web layer maps them to messages, the future API to RFC 7807.

### 7.3 Tenancy and Row-Level Security

- **NFR-SEC-1** Every tenant-owned table has `tenant_id`, RLS enabled and forced, and a **fail-loud** policy: a query without a tenant or system context raises an error, it never silently returns nothing (port ADR-036/038/039 design, simplified to one context).
- **NFR-SEC-2** Context is set per transaction with `set_config('app.tenant_id', …, true)`; system context (`app.rls_system`) only for cross-tenant jobs and super admin, each call carrying a reason string that is logged.
- **NFR-SEC-3** Issue-point restrictions per user are enforced in core (query filters), backed by tests; RLS covers tenant isolation.
- **NFR-SEC-4** The application DB role is not a superuser and has no `BYPASSRLS`; migrations run as a separate owner role.
- **NFR-SEC-5** A catalog test fails if any table with `tenant_id` lacks a forced policy (port `tests/integration/rls-fail-closed.test.js` idea).

### 7.4 Test vs production: two separate dimensions

The old system used "sandbox" for two different things. The new one keeps them apart:

1. **Deployment environment** (`APP_ENV`): local, staging, production. Each is a separate deployment with its **own database**. Staging is only for rehearsing releases; no real customer works there.
2. **Tenant mode** (`TEST` / `PRODUCTION`): which SRI environment a company's documents go to. It exists inside every deployment, because a real company on production still tests before going live.

| Deployment (`APP_ENV`) | Database | Tenant `mode = TEST` (twin) | Tenant `mode = PRODUCTION` |
|---|---|---|---|
| local / staging | its own | SRI test, ambiente 1 | SRI test, ambiente 1 (safety rail) |
| production | production DB | SRI test, ambiente 1 | SRI production, ambiente 2 |

**Tenant mode is implemented as a test organization (twin), not as a column or a schema.** The twin is just another row in `tenants`, in the same database and the same tables:

```
tenants
id    | ruc           | name                 | mode       | twin_of
t-100 | 1790011223001 | Mi Empresa           | PRODUCTION | null
t-101 | 1790011223001 | Mi Empresa (pruebas) | TEST       | t-100

documents  (one table; no sandbox schema, no environment column)
id | tenant_id | issue_point | sequential | status
d1 | t-100     | 001-001     | 123        | AUTHORIZED   -- real invoice, ambiente 2
d2 | t-101     | 001-001     | 7          | AUTHORIZED   -- test invoice, ambiente 1
```

- Switching to the twin changes the session's tenant context; RLS then shows only the twin's rows. Test orders, stock, documents, sequentials and reports can never mix with real ones, because they are isolated exactly like another company's.
- `twin_of` is used only by the switcher, the certificate copy, plan inheritance, membership mirroring and "copy master data". Nothing else crosses between the two.
- Why not the alternatives: a separate `sandbox` schema forced every migration to be written twice (old Common Mistake #14); an `environment` column on SRI tables only lets test documents touch real stock and reports; an `environment` column on every table works but needs a second RLS dimension in every policy, unique key and index; a separate database per mode doubles operations.
- A twin's data can be purged at any time without touching the real organization.

### 7.5 Jobs and schedules

| Job | Trigger | Notes |
|---|---|---|
| `sri.send` | enqueued with the document | singleton per document; quick retries with backoff (transport errors only) |
| `sri.authorize` | after RECEIVED | uncapped, schedule per FR-DOC-5 |
| `sri.send-deadline` | hourly, `0 * * * *` America/Guayaquil | end-of-day check → RECEIVED / SEND_FAILED |
| `sri.reissue` | hourly at :30, D+1 logic | per document job |
| `email.*` | after the triggering write | buyer email, notification emails, verification |
| `batch.item` | per batch item | per-tenant concurrency limit |
| `billing.daily` | 01:00 Ecuador | seats → tiers → renewals (keep this order), quota rollover |
| `notifications.scan` | every 15 min | certificate expiry, overdue authorizations, price-change catch-up |
| `payphone.reconcile` | every 5 min | stale attempts, approved-but-unapplied |
| `stock.verify` | nightly | ledger = levels |

- **NFR-JOB-1** Every handler is idempotent (re-fetch rows by id, check state before acting) because jobs may run more than once.
- **NFR-JOB-2** Schedules are declared in code with an explicit time zone; nothing depends on the host's cron or time zone.
- **NFR-JOB-3** SRI jobs run in a dedicated queue with its own concurrency, so slow emails never delay SRI work and vice versa.

---

## 8. Data model (outline)

Conventions:
- UUIDv7 primary keys (time-ordered), generated in the database with the native `uuidv7()`.
- `tenant_id` on every tenant-owned row; FKs everywhere; no hard deletes (status or `active` flag); `created_at`/`updated_at` with trigger.
- Money `numeric(14,2)` (SRI precision), unit prices and quantities `numeric(18,6)`; never floats in the domain (use a decimal library).
- Status columns are text with CHECK constraints generated from the TypeScript enums.

Main entities by module:
- **identity:** users, sessions, verification_tokens, memberships (user ↔ tenant, role), user_issue_point_access, audit_log.
- **tenancy:** tenants (ruc, names, main address, `mode` TEST/PRODUCTION, `twin_of` (nullable FK to tenants), unique (ruc, mode), status, language), branches, issue_points (codes, address, can_issue), certificates (encrypted key, cert pem, fingerprint, expiry, history), issue_point_document_types, sequentials.
- **entitlements:** plans, features, plan_features, tenant_feature_overrides.
- **billing:** subscriptions, payments, payment_proofs, payphone_transactions, tier_prices / seat_prices / pack_prices, quota_periods, document_pack_balances.
- **catalog/parties:** products, units, tax_profiles, clients, providers, document_templates.
- **inventory:** warehouses, stock_levels, stock_movements.
- **purchasing:** purchase_orders, purchase_order_lines, receipts, received_documents.
- **sales:** sale_orders, sale_order_lines, sale_order_invoice_lines, payments_received (receivables).
- **documents:** documents (type, issue point, sequential, access_key, status, issue_date, totals, buyer snapshot, signed_xml, authorization fields, external_reference, idempotency key/hash), document_lines, document_events, sri_responses, document_reissues, document_batches, document_batch_items.
- **notifications:** notifications, notification_reads, notification_preferences, email_templates, email_deliveries.
- **platform:** agreements, tenant_agreements, catalogs (`cat_*`).

---

## 9. Non-functional requirements

### 9.1 Load and performance targets

Assumptions for sizing (revise with real data):
- 2 years: 1,000 tenants, 200 concurrently active users at peak.
- 300,000 documents/month on average, peaks of 20,000/hour (month-end, bulk runs).
- Largest single batch: 10,000 invoices.

Targets:
- **NFR-PERF-1** p95 page server time < 300 ms for lists and detail pages at that size; p95 invoice creation (excluding SRI) < 800 ms (signing included).
- **NFR-PERF-2** SRI throughput limited by SRI, not by us: worker concurrency configurable; measure signing CPU per document in milestone 3 and record it in an ADR.
- **NFR-PERF-3** Bulk: a 10,000-invoice batch must not raise p95 for other tenants' single invoices by more than 2× (fair queuing, FR-BULK-4).
- **NFR-PERF-4** Lists paginate by keyset (UUIDv7 / date), never `OFFSET` on large tables.
- **NFR-PERF-5** Indexes on every `tenant_id`-leading access path; `documents` partitionable by month later (choose keys so partitioning needs no app change).

### 9.2 Scalability path (in this order, only when measured)
1. Vertical: bigger droplet, bigger managed DB.
2. Move `worker` to its own droplet (signing is CPU-heavy); cap its CPU in Compose until then so the UI stays responsive.
3. Several `web` instances behind Caddy/a load balancer + Redis for rate limits.
4. Read replica for reports; partition `documents` and `stock_movements` by month.
5. Connection pooler (PgBouncer, transaction mode) — keep RLS context per transaction so it stays compatible.

### 9.3 Security
- NFR-SEC-1..5 above; P12 private keys encrypted at rest (AES-256-GCM, key from env, key rotation procedure documented).
- Secrets only in env; validated at startup (fail fast with a clear message).
- CSP, secure cookies, CSRF protection for mutations (server actions + origin checks), no secrets in logs (explicit field allow-list, never log headers/query strings).
- File uploads: type sniffing, size limits per field (not per request), stored in Postgres (`bytea`) for small files or object storage for large ones.
- Dependency audit in CI; least-privilege DB roles.

### 9.4 Reliability and data
- Idempotency on every create from outside (forms resubmitted, double clicks, future API).
- Daily automated backups (managed DB) plus point-in-time recovery; quarterly restore drill documented.
- **Retention:** keep authorized documents and their XML for at least 7 years (verify the legal period); never hard-delete documents.
- Migrations: forward-only, `lock_timeout` set, deploy waits for health; never leave an SQL client open on production during a deploy.

### 9.5 Observability
- Sentry (web + worker) with request id tag; structured JSON logs (Betterstack) with request id, tenant id, user id, job id, access key; per-job outcome logs.
- Health endpoint (DB + queue); uptime monitor.
- Business alerts: SRI error rate, overdue authorizations, failed jobs, stock drift.

### 9.6 Accessibility
- WCAG 2.1 AA for core flows (forms, tables, dialogs); Base UI components help, but test with keyboard and screen reader.

---

## 10. Tech stack

Pin exact versions at project start (latest stable then); the choices:

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language for UI, core and jobs; the old API was JavaScript. |
| Runtime | Node.js 24 LTS | Same as today. |
| Monorepo | pnpm workspaces (+ Turborepo for task caching) | Shared core between web and worker. |
| Web framework | Next.js (App Router), React 19 | Reuses the current UI and team knowledge; server actions for mutations. |
| UI | Tailwind CSS v4, shadcn/ui (`base-nova`, Base UI), lucide, sonner, theme shim carried over from the previous web app (replaces next-themes), Recharts, react-day-picker | The previous web app's design system. |
| Forms / validation | React Hook Form + Zod | Same as today; Zod schemas shared with core. |
| Client data | TanStack Query for polling and live views only | Same rule as today (pages load via Server Components). |
| i18n | next-intl (es default, en) | Same as today. |
| Auth | Better Auth (database sessions, organizations, 2FA plugin) — or Auth.js v5 if Better Auth doesn't fit after a spike | DB sessions are revocable and make idle timeout simple; the old JWT sessions needed workarounds. Decide in milestone 1 with an ADR. |
| ORM / SQL | Drizzle ORM + drizzle-kit, SQL migrations committed and reviewed | SQL-first: triggers, CHECKs, partial indexes and RLS policies are first-class; transactions with `set_config` are simple. |
| Database | PostgreSQL 18 (managed, DigitalOcean) | RLS, JSONB, partitioning. |
| Jobs / schedules | pg-boss | Queue in Postgres: transactional enqueue, retries with backoff, singleton keys, throttling, cron schedules with time zone. Replaces RabbitMQ + outbox + droplet cron. |
| SRI XML | fast-xml-parser / a builder; `xmllint` (libxml2) in the image for XSD | Proven today. |
| Signing | node-forge (port of `helpers/signer.js`) | Proven XAdES-BES implementation. |
| PDF | PDFKit + bwip-js (port of `ride-builder.js`); react-pdf for previews | Proven. |
| Decimal math | decimal.js (or big.js) | No floats for money or quantities. |
| Dates | date-fns + date-fns-tz (America/Guayaquil helpers in one module) | Replaces moment. |
| Email | Mailgun (provider interface, swappable) | Same as today. |
| Payments | Payphone (card), SPI transfer with proof | Same as today. |
| Testing | Vitest (unit + integration against a real Postgres), Playwright (E2E), Testcontainers or a local Docker Postgres | Integration tests must run with RLS on. |
| Lint/format | ESLint + Prettier (or Biome) | |
| Monitoring | Sentry, Betterstack (winston/pino transport) | Same vendors. |
| Infra | Docker Compose on one DigitalOcean droplet, Caddy (TLS), managed Postgres, Terraform, GitHub Actions, Cloudflare DNS | Same model as today, fewer moving parts. |

---

## 11. UI and screens (MVP)

Layout, tokens and components carried over from the previous web app (Appendix A). Screens:

- Public: landing, pricing, support, login, register, verify email, forgot/reset password, accept invite, legal documents.
- Onboarding wizard; issue-point picker/switcher.
- Dashboard.
- Sales: sale orders (list, form, detail with invoices and stock), invoices (list, new, detail), credit notes, guías, bulk stack view, receivables.
- Purchases: purchase orders, receiving; after the MVP, received documents import, retenciones, liquidaciones.
- Inventory: stock levels, movements, adjustments, valuation.
- Master data: products, clients, providers, warehouses, templates.
- Documents: all documents, pending/failed ("Documentos pendientes"), detail timeline, re-issue/correct/void dialogs.
- Reports.
- Settings: organization, branches and issue points, certificate, document types, users and roles, notifications, billing (plan, seats, packs, payments, proofs), legal documents, test/production mode.
- Super admin area.

Status badges cover every document state including `SEND_FAILED`, "retrying until 23:59", "re-issued".

---

## 12. Infrastructure and deployment

- **Deployment environments:** local (Docker Postgres, `SRI_MOCK_MODE` optional, SRI test endpoint), staging (same shape as production, own database, brought up on demand, `lon1` if `nyc1` is unavailable), production. Each has its own database; tenant mode (test twin vs real organization) exists inside each of them (7.4). Outside production, every document goes to SRI test regardless of tenant mode.
- **Production topology:** one droplet (2 vCPU / 4 GB to start) running Caddy, `web`, `worker`; managed Postgres in the same region; DO Spaces for backups and large files. Memory limits per container in Compose; worker CPU capped.
- **CI (GitHub Actions):** lint, type-check, unit, integration (Postgres service with RLS), build image, dependency audit; E2E on main.
- **CD:** merge to `main` deploys to staging when `STAGING_INFRA_ENABLED=true`; a GitHub Release deploys to production. Migrations run before the new version starts, with `lock_timeout`; deploy waits for `/health`.
- **Terraform:** droplet, firewall, reserved IP, DNS, DB cluster, Spaces. Treat `user_data` changes carefully: they force droplet replacement. Use `ignore_changes = [user_data]` plus documented `-replace` for intentional rebuilds, and always `terraform plan` before `apply`.
- **Cutover from the current system:** see 15, milestone 10. Production today holds mainly the owner's own data; migrate tenants, issuers (→ branches/issue points), certificates (re-encrypt if the key changes), sequentials (**must continue exactly**), authorized documents and XML (read-only history), clients and products. Old access keys must keep resolving in the new system. The owner's company gets a complimentary subscription (FR-PLAN-1b), and migrated documents don't use quota. Data in the old `public` schema goes to the real organization; data in the old `sandbox` schema (and `tenants.sandbox = true` tenants) goes to the test twin, or is dropped if not worth keeping.

---

## 13. Documentation to produce

Docs are part of every change, not a follow-up (a milestone isn't done until its docs are).

| Doc | Audience | Content |
|---|---|---|
| `CLAUDE.md` | AI assistants / developers | Architecture, module rules, critical rules, common mistakes (start with Appendix B's list), key files, commands. Kept current every milestone. |
| `README.md`, `GETTING_STARTED.md` | Developers | What it is; local setup (Docker Postgres, env, seed, run web + worker, SRI test cert). |
| `docs/architecture.md` | Developers | Diagrams, modules, data flow, jobs, tenancy. |
| `docs/adr/` | Developers | One ADR per decision (stack, auth, pg-boss, RLS, environment column, retry calendar, re-issue, entitlements, costing method, …). An ADR carried over from the previous system holds its full reasoning itself, with no link back. |
| `docs/domain/sri.md` | Developers | Section 6 expanded: document types, XML, signing, statuses, error codes, retry calendar, re-issue, correction, void. |
| `docs/domain/erp.md` | Developers | Orders, stock ledger, costing, partial invoicing rules. |
| `docs/guides/coding-guidelines.md` | Developers | Patterns, adding a module, adding a document type, adding a job, adding an entitlement. |
| `docs/guides/testing.md` | Developers | Unit/integration/E2E, fake clock for SRI calendar tests, SRI test environment. |
| `docs/guides/documentation-checklist.md` | Developers | What to update per change type. |
| `docs/deployment.md` + env reference | Operator | Environments, first deploy, release, rollback, migrations, secrets, Terraform, backups and restore drill. |
| `docs/runbooks/` | Operator | SRI outage, overdue authorizations, failed jobs, payment review, Payphone "I paid but nothing happened", certificate expiry, stock drift, restoring a production copy safely (webhooks off, mock SRI, no email). |
| `docs/user-guide/` (es, en later) | End users | Onboarding, invoicing, orders, stock, purchases, billing, roles, FAQ on SRI statuses. Also served in-app as help. |
| `CHANGELOG.md` | Everyone | Keep a Changelog; SemVer releases. |
| `NEXT_STEPS.md` | Owner | Open work only (no history). |

---

## 14. Testing strategy

- **Unit:** core functions with a fake clock (Ecuador time edge cases: 23:59, month end, D+1, D+2), access key, Module 11, totals and taxes, state machine, entitlement resolution, costing.
- **Integration:** against real Postgres with RLS on: two-tenant isolation per table, fail-loud without context, transactional order → invoice → stock, sequential concurrency (parallel creates never duplicate), idempotency races.
- **SRI:** XSD validation of every builder against fixtures; signed XML verified; mock SRI server for transport failures (timeouts, 5xx, 43, 70, 45); real SRI test environment in a manual/nightly suite with a test certificate.
- **E2E (Playwright):** onboarding → first invoice authorized (mock SRI); sale order partial invoicing; bulk batch; purchase receipt → stock; billing upgrade.
- **Load:** k6 script for invoice creation and list pages at the section 9.1 targets before production cutover.
- Coverage is not a goal by itself; every bug fixed gets a regression test.

---

## 15. Delivery plan (milestones and gates)

Each milestone: code + tests + docs. Local first; staging only before production.

| # | Milestone | Scope | Gate |
|---|---|---|---|
| 0 | Foundations | Monorepo, CI, config validation, Drizzle + migrations, RLS helpers and catalog test, pg-boss wiring, logging/Sentry, design system port, i18n, CLAUDE.md, ADRs for stack | Empty app deploys locally with Docker; RLS catalog test passes |
| 1 | Identity and tenancy | Auth, sessions, users/roles/invites, onboarding wizard creating the real organization and its test twin, switcher toggle, go-live flow, certificates (written to both), branches/issue points, warehouses auto-created, legal agreements, audit log | Two tenants and a tenant/twin pair fully isolated (integration); ambiente rule covered for every deployment × mode cell; invite + role restrictions E2E |
| 2 | Entitlements and plans | Feature keys, modules, plans, subscriptions with items (no payments), overrides, resolver, UI gating, admin editor including Personalizado and complimentary | Toggling a feature per tenant changes UI and core behaviour |
| 3 | SRI engine: factura | Catalogues, products/clients (basic), builder, XSD, signer, access key, sequentials, direct invoice, send/authorize jobs, RIDE, buyer email, statuses, retry calendar, deadline check, re-issue, correction, void with verification, 24 h alert | Invoice authorized in SRI test env; fake-clock tests for 23:59 / D+1 / month end; 43/70 handled |
| 4 | Other SRI documents | Nota de crédito (with balance lock and stock return), guía de remisión | Each type authorized in SRI test env with its RIDE |
| 5 | Inventory and purchasing | Ledger, levels, adjustments, opening balances, POs, receiving, average cost | Receipt and adjustment reflected; nightly verify finds no drift |
| 6 | Sales | Sale orders, reservations, partial invoicing, correction from the order, receivables basic | 10 units invoiced 4 + 6 → INVOICED, stock right; NOT_AUTHORIZED corrected via order; void returns quantities |
| 7 | Bulk invoicing | Batches, fair queuing, stack view | 1,000-item batch locally with quota cut; other tenant's invoice latency within NFR-PERF-3 |
| 8 | Billing | Subscriptions, payments (SPI + Payphone), proofs, review, packs, renewals, past due, prices with notice, seats, operator invoicing queue | Full upgrade/renewal/expiry cycle with fake clock; Payphone test card |
| 9 | Notifications, reports, admin | All notification types/emails, dashboard, reports and exports, super admin area | Reports match seeded data; templates editable |
| 10 | Production readiness and cutover | Load test, security review, backups/restore drill, data migration from the current system, staging rehearsal, runbooks, user guide | Migrated copy reconciles (counts, sequentials, XML hashes); deploy checklist done; security review done with no open high or critical findings; restore drill passed; load test meets NFR-PERF-1 and NFR-PERF-3; hardening backlog in `NEXT_STEPS.md` empty or each remaining item accepted by the owner |
| 11+ | Post-MVP | Retención, liquidación de compra, received XML import; public API, API keys, webhooks, batches API, MCP, OAuth, developer docs, Integración plans | — |

Order rationale: the SRI engine (3) comes before ERP modules because every sales flow ends in it; billing (8) comes late because the owner is the only paying user until cutover, but its data model is created in milestone 2.

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| Rewrite takes much longer than planned (solo developer) | Port proven code (Appendix A); milestones shippable; keep the current system running until cutover. |
| Losing hard-won edge cases | Appendix B list in CLAUDE.md from day one; port tests along with code. |
| SRI behaviour differs from the ficha | Nightly suite against SRI test env; mock server mirrors observed answers. |
| Single droplet saturates during bulk runs | Worker CPU cap, fair queuing, move worker out per 9.2. |
| Legal rules unverified (consumidor final cap, void deadline, retention period, chronological order) | Config values, open-questions list, accountant review before cutover. |
| Data migration breaks sequentials | Reconcile script (last sequential per issue point/type/env) must match exactly before switching. |

---

## 17. Open questions

1. ~~Document packs: sizes, prices, expiry vs rollover; which plans can buy them~~: decided, they roll over until used, any plan with a quota buys them, and sizes and prices start as placeholders the operator replaces (ADR-031).
2. ~~Add-ons or whole plans only~~: decided, modules as add-ons and a negotiated Personalizado (ADR-011). Prices per plan and module: Milestone 8.
3. Accountant: month-boundary re-issue and chronological order; consumidor-final cap; void deadline; retention period; which IVA rates beyond 0%, 15%, 5%, not subject and exempt a product may carry (the 13% by decree, the differentiated rate; ADR-012).
4. Verify resolutions NAC-DGERCGC25-00000014/17 texts.
5. ~~Is "RUC Proveedor" campo adicional still required?~~ Yes: Anexo 26 of Ficha v2.34 (ADR-013).
6. Costing method: weighted average (proposed) vs FIFO.
7. ~~Auth library~~: decided, Better Auth (ADR-009).
8. Product name/branding for the ERP (keep "Comprobify"?).

---

## Appendix A — What was carried over

Everything this system needed from the previous repositories is now in this one, adapted to TypeScript and this architecture: the XAdES-BES signer, access keys and Module 11, the XML builders and XSDs, the SRI catalogues (`packages/core/src/sri`); the RIDE, the SOAP client and its mock; the send, authorize and deadline logic, re-expressed as pg-boss jobs (`packages/core/src/documents`); the billing rules and Payphone (`packages/core/src/billing`); the email texts and the legal texts; the design system, layout, banners and UI strings (`packages/ui`, `apps/web`); the roles and permissions; and the decisions still valid, as carried-over ADRs that hold their own reasoning.

Two things are still to bring over before the previous repositories are deleted, tracked in `NEXT_STEPS.md`: the infrastructure and deploy patterns (Milestone 10), and the public API documentation site (Milestone 11+).

## Appendix B — Leave behind, and lessons to keep

**Leave behind (existed only because of two systems):** reserved API keys and the reserved pool, `requireInternalService` and the BFF secret, P12-based account recovery and `alreadyLinked`, promotion key mirroring, tenant = API key identity, duplicated tenant/issuer/key/notification/webhook rows in the web DB, the webhook receiver that syncs notifications into the web DB, the `sandbox` schema duplicate and the `tenants.sandbox` flag (replaced by the test twin, 7.4), RabbitMQ + `pending_effects` + reconciliation sweep, droplet cron jobs, two migration tools.

**Lessons to keep (put them in the new CLAUDE.md "Common mistakes"):**
1. Never derive billing period dates from "now" except for the first period and promotion; anchor to the previous period end, and clamp month-end arithmetic.
2. Daily billing job order: seat changes → tier changes → renewals.
3. Price a deferred period at the price in effect on the date it starts, and with the seat count effective then.
4. Validate XSD before signing; validate element order.
5. Single-use tokens: non-consuming GET, consuming POST.
6. Never log auth headers or query strings; build log fields explicitly.
7. Parse UUIDs as UUIDs, never `parseInt`.
8. A `NaN` can reach the database as a valid numeric; check that source fields exist.
9. An empty env var is not "unset": `parseFloat('')` is `NaN`; validate config at startup.
10. Files read at runtime must not be excluded from the Docker image (`.dockerignore`).
11. Cloudflare email obfuscation breaks proxied HTML with emails; disable it for app hosts.
12. An open SQL client blocks migrations; set `lock_timeout`, wait for health.
13. A restored production copy sends real emails/webhooks/payments unless explicitly disabled.
14. Every state-transition change updates code and DB trigger together (generate both from one source here).
15. Rate limiters: one per abuse vector, shared store when more than one instance.
16. Background polling must not count as user activity for session idle timeout.
17. Payphone: confirm within 5 minutes, persist the vendor id even when saving the outcome fails, never apply a duplicate charge, minimum charge $1.00.
18. A payment's display amount is `total_amount` and its target tier/interval, not the subscription's current ones.
