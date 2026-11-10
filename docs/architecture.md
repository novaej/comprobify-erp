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

`resolveActor` resolves them once per request into `ctx.entitlements`: the override wins, then subscription items, then the plan, then off. Boolean keys are the union of every module's keys; a coming-soon module grants nothing; a module or key removed with a date stays until the company's first period start after it: its billed period, or the month that renews from its anchor day when nothing is billed (ADR-028). Core checks with `requireFeature` (`FEATURE_NOT_ENABLED`) and `requireWithinLimit` (`LIMIT_REACHED`; a missing limit is 0, `null` is unlimited). The loader filters by `tenant_id` itself, so code without an actor, such as accepting an invitation, can resolve a company in system context.

The super admin edits the catalog from the platform area (`platform/catalog.ts` over `entitlements/catalog-admin.ts`): additions are immediate, and removals and lower limits are dated 30 days ahead, so they reach each company at its next period. Each change is recorded in `platform_audit_events`, append-only and written only in system context.

The web app only hides or locks: nav items carry a feature key, a page behind one renders `FeatureLocked`, and the plan page shows the plan, its modules and each limit with its usage (`planOverview`, `companyUsage`).

## Company settings

The company's tax data (accounting flag, contribuyente especial and agente de retención resolutions, the RIMPE regime), its branches and issue points, and the document types each issue point issues are edited from the Empresa page and written to the company and its twin together, matched by code (`tenancy/settings.ts`). New branches and issue points count against the plan's `MAX_BRANCHES` and `MAX_ISSUE_POINTS_PER_BRANCH`. Enabling a document type needs its `DOC_TYPE_*` feature and a builder for it; one already enabled keeps working if the plan loses it (FR-PLAN-3). Every enabled type has a row in `document_sequences`, per issue point: the twin counts its own. At go-live the owner can set the real company's next numbers, for a company coming from another provider; a sequence only moves forward.

## Master data

Clients (`parties`) and products and services (`catalog`) are tenant data under RLS, behind the `CLIENTS` and `CATALOG` features and the `clients.*` and `catalog.*` permissions. Providers (`parties`, FR-MD-3) have the client's identity rules and payment terms, behind the `PROVIDERS` feature: `purchasing.read` to see them, `providers.manage` to change them. A company and its twin keep their own lists. Consumidor final is never a row. A cédula must pass its check digit; a RUC is checked by structure only, as onboarding does. Prices are `numeric` with six decimals and stay decimal strings end to end (ADR-012). Nothing is deleted: an inactive client or product drops out of the pickers and stays on its documents.

Purchase orders (`purchasing`, FR-PUR-1, ADR-019) ask a provider for catalogue products at a cost without IVA, for one warehouse. Each company numbers its own from `tenant_counters`, taken in the order's transaction. A draft is edited as a new revision of its lines, never by deleting rows, and the app role may update only a line's `received_quantity`. The status machine is one TypeScript definition that generates the CHECK, the trigger (`transitionTriggerBody`, shared with documents) and core's checks. Receiving (FR-PUR-2) locks the order, refuses more than is left, and moves stock through `inventory`'s `applyMovement` in the same transaction: a `PURCHASE_RECEIPT` at the order's cost, for goods that track stock. Receipts are append-only. The order's PDF is drawn from the stored order; emailing a draft sends it and enqueues `purchasing.email` in the same transaction, and the job sends the PDF to each address (FR-PUR-3). The module calls `parties` for the provider, `catalog` for the products, `inventory` for stock, `tenancy` for warehouses, numbers and the company header, `email` for the message, and `sri` for rounding.

## Sales

Sale orders (`sales`, FR-SAL-1, ADR-021) are what a client asks for, at a price, from one warehouse. A null client is consumidor final. Each company numbers its own from `tenant_counters`, taken in the order's transaction, and lines are priced as SRI rounds a factura (`lineAmounts`, `documentTotals`), so an order's total is its invoice's. An edit adds a new revision of the lines, never deleting rows, and the app role can't update a line. The status machine is one TypeScript definition that generates the CHECK, the trigger (`transitionTriggerBody`, shared with documents and purchase orders) and core's checks; it already allows the backward moves a voided invoice will need. Confirming holds the goods that track stock as `RESERVATION` movements whose source is the order, through `inventory`'s `reserveDocumentStock`, in the same transaction as the status change, and cancelling (or editing a confirmed order) releases them with `releaseDocumentStock`. The module calls `parties` for the client, `catalog` for the products, `inventory` for stock, `tenancy` for warehouses and numbers, and `sri` for rounding.

**Invoicing an order** (ADR-022, `documents/order-invoice.ts`). `invoiceSaleOrder` runs the invoice pipeline (`issueInvoice`, the same function `createInvoice` wraps) inside the order's transaction: it locks the order, checks each requested quantity against what is left (coverage is read from `sale_order_invoice_lines`, append-only and per document revision, counting every document that isn't voided), builds the lines at the order's prices with the line's discount shared out by quantity, inserts the document, links it to the order, passes the order's hold to the invoice (`transferOrderHold`) and syncs the order's status, all before the send job is queued. SRI's authorization syncs the status again (`INVOICED` needs authorized invoices), a void returns the goods and holds them for the order again, and `correctOrderInvoice` re-composes an invoice from the order. `sales` never imports `documents`: the workflow lives in `documents`, which calls `sales` and `inventory` through their indexes.

The **guías of an order** (ADR-023) go with its invoices: the order page offers the guía-from-invoice form on each, `saleOrderGuides` lists the guías whose invoice belongs to the order, and a guía's detail names its order through that invoice. There is no link of its own; dispatch before invoicing is not built.

**Receivables** (`receivables`, FR-SAL-10, ADR-024) keep payments received for authorized invoices in `invoice_payments`: an amount, a date, a method and a reference, never edited (the app role can only void one, with a reason). What an invoice owes is its total less the authorized credit notes made against it less its payments that aren't voided; its status (unpaid, partly paid, paid) is worked out from them, never stored. `documents` gives the module the invoices' facts (`receivableInvoice`, `receivableInvoices`: total, credited, due date from the longest plazo), and `receivables` never reads their tables. Recording a payment locks the invoice, so two at once can't both take its balance. The aging report cuts what is owed by days past the due date, as of today in Ecuador.

**Going live** can copy the twin's master data (`masterdata/copy.ts`, ADR-025): in the go-live transaction, in system context, the active products, clients, providers and invoice templates the real company lacks are added, with templates moved to the real copies of their client and products. It is once (go-live is one-way) and never includes transactions, stock or orders.

## Inventory

The `inventory` module keeps stock per product and warehouse (one warehouse per branch, FR-MD-4). `stock_movements` is the append-only ledger: the app role can't update it. `stock_levels` holds on hand, reserved, value and the weighted average cost, one row per product and warehouse. `applyMovement` is the only way stock changes. It runs in the caller's transaction, locks the level row, refuses an outflow beyond what is available when the company's `negative_stock` rule is `BLOCK`, and writes the movement and the level together. Each movement records its signed quantity and its signed change to the level's value, so the ledger sums to the level exactly. Stock moves only with the `INVENTORY` feature and for goods that track stock (ADR-018, FR-INV-1 to FR-INV-6). By hand, `adjustStock` moves stock in or out with a reason, `setOpeningBalance` sets a level's first movement, and `importOpeningBalances` takes a spreadsheet, whole or not at all.

**Screens.** `/inventory` lists every good that tracks stock with its on hand, reserved, available, average cost and value, in one warehouse or all (`listStock`); goods with no movement yet show zeros. `/inventory/[productId]` shows a product per warehouse with its movements, and its adjustment and opening-balance dialogs (`productStock`). `/inventory/valuation` totals the stock at its average cost per warehouse, with a CSV export in the format the locale's spreadsheet opens (`stockValuation`). The company's negative-stock rule is a switch in Empresa. All of it needs `INVENTORY` and `inventory.read`, and the changes `inventory.adjust`. Product names come through `catalog` and warehouses through `tenancy`, never by reading their tables.

**Documents move stock** (ADR-020, `inventory/document-stock.ts`, called from `documents`). An invoice holds its goods (`RESERVATION`) in its issue point's warehouse when it is created, and SRI's authorization turns that into a `SALE` in the same transaction as the AUTHORIZED transition. A correction lets go of what the document held and holds its new lines. A void brings back what was sold and not yet returned, at the sale's cost. A credit note with `returns_stock` brings its return lines back when SRI authorizes it, and voiding it takes them out again. Every such movement points at its document, so what a document holds or sold is read from the ledger. The worker moves stock through `moveStock`, which is `applyMovement` without an actor; the movements a document already has decide what happens, not the plan at that moment.

**The nightly check** (`inventory.verify`, 02:45 Quito time) compares every level with the sums of its movements, in quantity, reserved and value, and logs each difference as an `inventory.drift` error. The average isn't compared, since an outflow keeps it while rounding moves value over quantity by a millionth (FR-INV-2, ADR-018).

## Documents

The `documents` module holds every electronic document: one row per document, with the buyer and totals as a snapshot, and its lines, payments and timeline in `document_lines`, `document_payments` and `document_events`. Those three are append-only: the app role can't update them, so a correction adds a new revision of the lines and the row points at it. The status machine is one TypeScript definition (`DOCUMENT_TRANSITIONS` in `packages/db/src/schema/documents.ts`) that generates the status CHECK and the trigger body in the migration; a test compares the live trigger with it (FR-DOC-3). A document can come from another: `related_document_id` points a credit note at its invoice and a guía optionally at one, through a composite foreign key that keeps it inside the company, and it is fixed at creation like the number. A credit note's lines say which invoice line they credit, and what an invoice has left to credit is computed from them under a lock on the invoice (ADR-016). A second trigger keeps the number fixed forever, sets the authorization once, and lets the content and access key change only when a document goes back to `SIGNED` to be corrected or re-issued. Sequentials come from `document_sequences` under `SELECT … FOR UPDATE` in the creating transaction, so a rolled-back document gives its number back and two at once never share one. The access key is built in `sri/access-key.ts` with its Module 11 check digit, from the issue date in Ecuador time.

`createInvoice` is the FR-DOC-2 pipeline, all in one tenant transaction:

1. An idempotency key, held by an advisory lock, returns the existing document for the same payload and refuses a different one.
2. `issuingContext` (tenancy) checks that the company is live (the twin always is), that the issue point is active, not paused and allowed to the actor, and that there's an active certificate.
3. The quota is taken in a live company, never in the twin.
4. The sequential, the access key, the XML, the XSD check, the signature, then the rows.
5. The `sri.send` job is enqueued last.

Any refusal rolls the number back. The buyer is a client read through `parties` or consumidor final, within its cap. A losing plan feature doesn't stop a document type already enabled on an issue point (FR-PLAN-3).

## SRI XML and signing

`sri/factura.ts` builds the factura XML in the XSD's element order, through a small writer (`sri/xml.ts`) whose output is already in canonical form: double quotes, sorted attributes, no self-closing tags, C14N's escapes. `validateXml` checks it with `xmllint` against the XSDs embedded in `sri/xsd/`, before anything is signed. `signXml` adds the XAdES-BES signature SRI accepts: RSA-SHA256, two references, the certificate only in KeyInfo. Its tests verify it with a real C14N implementation (ADR-013).

`sri/client.ts` talks to SRI's reception, authorization and Consulta de validez services. It sends one request per call and throws `SriTransportError` only for transport failures, which are the only ones the jobs retry. It maps SRI's answers to `RECEIVED` (43 and 70 included), `RETURNED`, `AUTHORIZED`, `NOT_AUTHORIZED`, `PENDING`, and the validity states. The endpoint comes from the document's ambiente. `createMockSri` answers like SRI (RECIBIDA, DEVUELTA, 43, 45, 70, scripted failures) for tests and for `SRI_MOCK_MODE` (ADR-014).

## Sending to SRI

Creating a document enqueues `sri.send`. The worker's handlers (`documents/sending.ts`) each re-read the document under a row lock, act only if its status still calls for it, and call SRI outside any transaction. Each step is its own job, scheduled with `startAfter` from `documents/calendar.ts`:

- **Send** (FR-DOC-4): `RECEIVED` schedules the first authorization check; `RETURNED` stops, and code 45 is logged for a person. A transport error makes it `SEND_FAILED` and schedules the next try: five about five minutes apart, then hourly with a spread. Retries stop at 23:59:59 of the issue day in Ecuador (`retry_until`).
- **Deadline check:** once a try would pass that deadline, `sri.deadline` asks SRI once, read-only. If SRI has the document, it moves on to `RECEIVED` and its answer. If not, or if SRI couldn't be asked (`sri_unreachable`), it stays `SEND_FAILED` for the next-day re-issue.
- **Authorization** (FR-DOC-5): checked quickly, then hourly for three days, then daily, never capped.
- **Overdue sweep:** `sri.overdue` runs every 15 minutes and flags, once, any document still `RECEIVED` 24 hours later.

**Next-day re-issue** (FR-DOC-6). At 00:30 in Quito, `sri.reissue-sweep` enqueues one `sri.reissue` job per document left `SEND_FAILED` the day before. Each job:

1. Asks SRI again. A document SRI got after all moves on to its answer.
2. If SRI still lacks it, rebuilds it from its own signed XML with today's date and a new key (`redateSignedXml`), keeping the same sequential and every other byte.
3. Validates and signs it again with the company's active certificate.
4. Records the old key, date and XML in `document_reissues`, and sends it.

A document is never moved into another month automatically; a person decides, and older ones too. A transport error during the check fails the job, so pg-boss retries it.

**Correction** (FR-DOC-7). `correctInvoice` takes a document SRI returned or rejected, or never got, and resends it as the same row and sequential with new content. It keeps the same key on the issue day, and takes today's date and a new key after it; the old key, date and XML go to `document_reissues` as `CORRECTED`. Lines and payments get a new revision, and the old ones stay. A `SEND_FAILED` document can be corrected only once the deadline check confirmed SRI didn't have it. Before that, it may still be at SRI.

**Manual re-issue** (FR-DOC-6). From D+2, or for a document the automatic run left at a month boundary, a person confirms the new date and `requestReissue` queues the same `sri.reissue` job, reason `MANUAL`. If the confirmed date is no longer today, it asks again.

**Void** (FR-DOC-8). The company voids on SRI's portal. `voidDocument` marks a document `VOIDED` only once Consulta de validez shows it voided or pending a void. It refuses consumidor final, and takes the user's attestation only when SRI can't be asked.

`findByAccessKey` resolves an old key to its document.

**RIDE and buyer's copy** (FR-DOC-10, FR-DOC-11).

- **RIDE:** `rideData` reads everything on the RIDE from the authorized XML. Only the logo is live. `renderRide` draws the A4 PDF with pdfkit and the access key's Code 128 barcode. It reads a factura and a nota de crédito (the latter adds the document it modifies and the reason, and has no payments; a new type adds its reader and drawing the same way). A guía de remisión is drawn with its own blocks (ADR-017).
- **Buyer's copy:** becoming `AUTHORIZED` enqueues `documents.email` in the same transaction. It sends the RIDE and SRI's `<autorizacion>` XML from "`<company>` via Comprobify", once, while the plan has `BUYER_EMAIL` and the buyer has an email. A person can resend it.
- **Test environment:** in ambiente 1 the email says it is a test document (ADR-015).

**Screens** (FR-DOC-12). `/documents` lists, filters and pages documents. `/documents/new` is the invoice form. `/documents/[id]` shows one document with its timeline, and its `ride` and `xml` routes serve the files. The reads are in `documents/queries.ts`, and a user restricted to issue points sees only theirs (FR-ROLE-2).

The form's live totals use exact integer arithmetic with ADR-012's rounding (`apps/web/src/lib/invoice-totals.ts`), and a test holds them to core's `documentTotals`, so the screen never disagrees with the stored document by a cent. Keyboard entry (FR-UX-4):

- The code field searches products by code or name, through the shared `Combobox` block.
- Enter moves along the line and selects what's in the next field.
- Enter in the discount opens a new line.

The client's name, emails, phone and address can be edited in the form. A user with `clients.manage` saves those edits with the invoice: `createInvoice` updates the client through `parties` in the same transaction. The identification never changes there, since a different one is a different client.

**Templates** (FR-MD-5). They're behind `DOCUMENT_TEMPLATES`, which comes with the Branding module:

- **Saving:** the form's client, lines, payments and additional information, validated by the invoice's own rules, so a loaded template issues as it is. Saving under a name already in use replaces that template.
- **Removing:** a removed template is inactive, never deleted.
- **The test copy** keeps its own templates.

While SRI hasn't answered, the detail page refreshes itself. It refreshes quickly at first, then every half minute, and never while the tab is hidden. Refreshing isn't user activity, so it never keeps an idle session alive (FR-USR-2).

**Actions** (FR-DOC-6 to FR-DOC-8, FR-DOC-11). `documentActions` decides what a document offers: correct, re-issue, void, resend. It applies the same rules as the actions themselves, plus the user's role and plan, and the detail page shows only those.

- **Correct:** opens the invoice form filled from `correctionDraft` (the lines, payments, client and additional information as last signed).
- **Re-issue:** confirms the new date before queueing the worker's re-issue.
- **Void:** checks Consulta de validez from the web, and falls back to the user's attestation when SRI can't be asked.

`/documents/pending` groups what isn't final yet, putting what needs a person before what waits for SRI.

Every transition writes an event with SRI's messages, and every call to SRI writes a row to `sri_exchanges`, including the ones that changed nothing, with who answered: SRI or the mock (ADR-014). Every signed version of a document is kept in `document_versions`, so a correction never loses what was sent before. CI and the local stack always run the mock.

## Audit log

`audit_events` is tenant data with RLS, and append-only: the app role can insert and read, not update or delete. Core writes an event with `recordAudit` in the same transaction as the change, so a rolled-back change leaves none. Event names are one TypeScript list that generates the CHECK, and the web test requires a label for each. Changes to an organization and its twin are recorded in the real organization's log.

## Jobs

Queues are declared in `packages/core/src/jobs/registry.ts` with a Zod payload, options and concurrency. Schedules are declared there too, in `America/Guayaquil`. The migrate step creates the queues; the worker applies the schedules at start and removes ones no longer declared. Handlers must be idempotent (NFR-JOB-1).

## Startup

Web and worker load their env schema, then run the boot guard. Either failure stops the process with a list of problems. `/health` checks the database and queue, and deploys wait for it.
