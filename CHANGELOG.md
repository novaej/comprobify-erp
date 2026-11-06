# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- pnpm workspace with Turborepo, strict TypeScript, ESLint and Prettier.
- Lint rules for the core module boundaries (NFR-ARCH-1, NFR-ARCH-4, NFR-ARCH-5).
- `CLAUDE.md`, the stack ADRs and the first setup docs.
- Env validation per process, with `.env.example` kept in sync by a test.
- Allow-listed JSON logger with optional Betterstack shipping.
- Core kernel: actor context, `DomainError` and `Clock`.
- `pnpm db:setup`, `db:migrate` and `db:generate`, with separate owner and app roles (NFR-SEC-4).
- Fail-loud RLS functions and `app_enable_tenant_rls()` in the first migration (NFR-SEC-1).
- `createDatabase`, with `withTenant`, `withSystem` and a boot guard (NFR-SEC-2, NFR-SEC-4).
- RLS isolation and catalog integration tests on probe tables (NFR-SEC-5).
- pg-boss in its own schema, with a queue registry, transactional `enqueue` and schedules in Ecuador time (NFR-JOB-1, NFR-JOB-2, NFR-JOB-3).
- Worker app with the boot guard and a `system.heartbeat` job.
- `packages/ui` with the design system ported from `comprobify-web`, and a theme script that prevents the flash of the wrong theme.
- Web app: localized home, error and not-found pages in Spanish and English, `/health`, request ids and Sentry.
- One Docker image for web, worker and migrate, and a local Compose stack with Caddy.
- CI: lint, types, unit and integration tests, image build, dependency audit, and an E2E smoke test on `main`.
- `LOG_FORMAT` (`json` or `pretty`).
- Architecture, coding, testing, documentation and deployment docs.
- Accounts with Better Auth: sign-up, email verification (the link's `GET` never consumes it), sign-in, sign-out, sign out everywhere and password reset (FR-ONB-1, FR-ONB-7, FR-USR-2).
- Database sessions with a 30-minute idle timeout that only real activity extends, and a 7-day absolute lifetime (FR-USR-2).
- Rate limits per abuse vector, stored in Postgres (FR-USR-4).
- `email.send` job with Mailgun, logged instead of sent locally; daily `identity.prune` job.
- Tenancy model: organizations with their test twin, branches, issue points, warehouses and mirrored memberships, all under RLS (FR-ONB-4, FR-ONB-6a, NFR-SEC-1).
- A user context for identity lookups, and the organization switcher's checks (FR-USR-5, ADR-010).
- Roles and permissions in core, with the database CHECK generated from the same list (FR-ROLE-1).
- The ambiente rule for every deployment × mode cell (FR-ONB-6).
- Onboarding: RUC structure check, any CA's P12, the certificate checked against the RUC, the private key encrypted with AES-256-GCM, certificate and logo stored on the organization and its twin, and the user starting in the twin (FR-ONB-2 to FR-ONB-4).
- `CERT_ENCRYPTION_KEY`, and `pnpm test-certificate` for local testing.
- Forms keep what was typed after an error.
- The app shell: sidebar layout with the organization switcher and its Producción / Pruebas toggle (production only after go-live), the sandbox banner, the certificate banner at 30 days and on expiry, a skip link, and a mobile drawer (FR-USR-5, FR-UX-2).
- A dashboard placeholder; signing in and onboarding land there.
- Users page: invitations by email (the link's `GET` never uses it up), role changes, soft removal and issue-point restrictions, each applied to the organization and its twin. New users set their password on the invitation and start verified (FR-USR-1, FR-ROLE-1 to FR-ROLE-3).
- Two-step verification with an authenticator app (TOTP) and single-use backup codes, set up and turned off from the account page; an organization can require it of every member (FR-USR-3).
- The company activity log: append-only, recording organization, certificate and member changes, the two-step requirement, go-live and sign-ins, readable by Owner, Admin and Accountant (FR-NOT-4).
- Go-live: the Owner takes the real company to production, one way, from a page that explains what changes (FR-ONB-5).
- Legal documents: the Terms, Privacy Policy and DPA as versioned texts published from the repo by the migrate step, a personalized copy per company, and acceptance by the Owner recorded with its copy, IP address and browser. Off (`AGREEMENTS_ENABLED=false`) until the owner approves the texts; when on, go-live requires them (FR-ONB-8).
- `AGREEMENTS_ENABLED`, `OPERATOR_NAME`, `OPERATOR_RUC`, `OPERATOR_ADDRESS` and `SUPPORT_EMAIL`.
- An isolation sweep: every tenant table, found from the database catalog, holds rows for two companies and a twin, and none sees another's (Milestone 1 gate, NFR-SEC-1).
- The plan catalog: feature keys in code, and modules and plans as platform data that only system context can write, with the starting catalog seeded once by the migrate step (FR-PLAN-1, FR-PLAN-2, ADR-011).
- Subscriptions: each company and its twin hold a plan, paid or complimentary, with add-on modules, Personalizado's limits and price, and per-company overrides, all under RLS. New companies start on Gratis, and the migrate step puts existing ones on it (FR-PLAN-1a, FR-PLAN-1b, FR-ONB-6a).
- Entitlements resolved once per request into the actor context, with `requireFeature` and `requireWithinLimit` in the kernel. Invitations respect the plan's users, counting pending invitations, and accepting rechecks it; the logo is used on documents only with the Marca module (FR-PLAN-3, FR-PLAN-4, FR-USR-1).
- The plan page: the company's plan, its modules (coming soon, add-ons, dated removals) and each limit with its usage. Menu items and pages can be hidden or locked by feature, and the users page says when the plan has no seats left (FR-PLAN-4).
- The platform area at `/admin`, for super admins with two-step verification: every company with its plan, and per company the plan, add-on modules (removed at the next month), Personalizado's limits and negotiated price, complimentary with a reason, and overrides, each mirrored in the twin and recorded in the company's activity log (FR-ADM-1, FR-PLAN-1a, FR-PLAN-1b, ADR-010).
- `pnpm super-admin <email>` to set the flag.
- Every screen rebuilt on shared blocks ported from the earlier web app: page header, stack tables that become cards on phones, section cards, form and confirm dialogs, toasts, toned badges, empty states, styled selects and marked required fields. Removing members, revoking invitations and the admin's changes now ask first; the account page sits in the app shell, onboarding and the no-company account in a standalone shell, and the admin area has its own sidebar. Every page has its own title (FR-UX-2, FR-UX-3).
- axe accessibility checks on every screen the E2E flow reaches, in light and dark, and screenshots on request. Fixes they found: contrast of the sidebar avatar and role tag, banner text, red buttons and neutral badges; the organization switcher's name; titles on every page.
- Plan and module editors in the platform area: names, status (moving forward only), whether a plan is bought from the app, a module's feature keys, a plan's modules and limits. Additions are immediate; removals and lower limits are dated 30 days ahead and reach each company at its next month. Every change is recorded in a new platform activity log. A super admin with no company lands in the platform area (FR-ADM-3).
- A separate `comprobify_erp_e2e` database for the E2E tests and the Docker stack, migrated before each run, so test data stays out of the one used with `pnpm dev`; `E2E_DATABASE_URL` and `E2E_MIGRATION_DATABASE_URL`.
- `pnpm db:reset <local|test|e2e|all>` to drop, recreate and migrate a local database.
- The Milestone 2 gate: switching a module, an exception or a limit for one company changes its screens and what core allows, in it and its twin, while another company on the same plan is untouched (E2E and integration).
- Decimal arithmetic with `decimal.js` and the rounding rules for SRI amounts, and the Ficha Técnica's catalogues (document types, identification types, taxes, IVA rates, payment methods, time units) as typed lists with labels in Spanish and English (ADR-012).
- Clients and products: list, search, create, edit and deactivate, behind the `CLIENTS` and `CATALOG` features and their permissions (a new `clients.read`). Cédulas are checked by their check digit and RUCs by structure; prices keep six decimals; products carry today's IVA rates and up to three additional details (FR-MD-1, FR-MD-2).
- The Empresa page: tax data (accounting, contribuyente especial, agente de retención, RIMPE regime), branches and issue points within the plan's limits, the document types each issue point issues (needing their feature), and pausing an issue point, all mirrored in the test copy and recorded in the activity log. Go-live takes the real company's starting numbers; sequences only move forward (FR-ONB-3, FR-ONB-5, FR-PLAN-3).
- The document core: documents with their lines, payments and timeline, the status machine enforced by a trigger generated from its TypeScript definition, an immutability trigger, sequentials taken under a row lock, and the 49-digit access key with its Module 11 check digit (FR-DOC-3, FR-DOC-13).
- The factura XML builder in the XSD's element order, validation with `xmllint` against the embedded factura XSD 2.1.0 before signing, and the XAdES-BES signer, verified in tests by a real C14N implementation (ADR-013, SRI rules 8 and 13).
- Creating an invoice in one transaction: idempotency keys, the live-company, issue point and certificate checks, the document quota (never in the twin), the consumidor final cap, payments that add up, the XML signed after XSD validation, and the `sri.send` job enqueued with it (FR-DOC-2, FR-DOC-9).
- The SRI client for reception, authorization and Consulta de validez, with codes 43 and 70 read as received and only transport errors thrown; a mock SRI that answers like SRI (RECIBIDA, DEVUELTA, 43, 45, 70, scripted failures) for tests and `SRI_MOCK_MODE` (ADR-014).
- Sending to SRI from the worker: the send, authorize, deadline and overdue jobs on FR-DOC-4's calendar in Ecuador time, retrying transport errors only, with every transition and SRI answer on the document's timeline. `SRI_TEST_URL`, `SRI_PRODUCTION_URL` and `SRI_TIMEOUT_MS`; the mock is on by default locally and always in CI and the stack (FR-DOC-4, FR-DOC-5).
- The next-day re-issue: yesterday's `SEND_FAILED` documents are re-checked with SRI and, if SRI still lacks them, rebuilt from their own XML with today's date, a new key and the same sequential, validated, signed and sent, with the old key, date and XML kept in `document_reissues`. Never across a month. Each re-issue is signed with the company's own certificate; the worker now needs `CERT_ENCRYPTION_KEY` to decrypt that company's stored private key (FR-DOC-6).
- `pnpm db:reset` reads the owner URLs from `.env` as text instead of loading it as shell code, which failed on values like `EMAIL_FROM=Comprobify <address>`.
- The document page no longer runs several queries at once on one connection (pg's deprecation warning).
- `pnpm typecheck` and `pnpm test` now rerun a package when a workspace package it uses changes; Turbo used to replay a stale cached pass.
- Correcting a returned, rejected or unsent invoice as the same row and sequential, the same key on its issue day and a new one after; re-issuing by hand from D+2 after confirming the date; voiding only what SRI's Consulta de validez shows voided, never consumidor final, with an attestation fallback; old keys resolve to their document (FR-DOC-6, FR-DOC-7, FR-DOC-8).
- The RIDE: an A4 PDF with the access key's Code 128 barcode, read only from the authorized XML (totals as SRI authorized them, the RIMPE and agente de retención legends, Quito time), breaking long documents onto more pages. The buyer's copy: RIDE and authorized XML emailed on authorization from "`<company>` via Comprobify", once unless resent, marked as a test in SRI's test environment. Email can now carry attachments (FR-DOC-10, FR-DOC-11, ADR-015).
- The document screens: Comprobantes in the sidebar, with the list (filters by status, issue point, dates and search; pages), the invoice form (client and product search, keyboard line entry, decimal commas, exact live totals, payments that add up, a confirmation before issuing) and the detail (summary, lines, totals, payments, timeline, SRI's reasons, earlier keys, the RIDE and XML). `CONSUMER_FINAL_MAX_AMOUNT` (FR-DOC-2, FR-DOC-9, FR-DOC-12, FR-UX-4).
- Acting on documents from their screen: correct a returned, rejected or unsent invoice in the invoice form filled from it; re-issue an older unsent one after confirming today's date; void one SRI shows as voided, with the deadline and an attestation when SRI can't be asked; resend it to the buyer. A pending screen groups what isn't final. The web reads the SRI settings to check voids (FR-DOC-6 to FR-DOC-8, FR-DOC-11, FR-DOC-12).
- The invoice form edits the client's name, emails, phone and address, saved on the client with the invoice. The document page follows SRI's answer without a reload. Clearer wording when issuing and voiding.
- Email settings from the old system: `EMAIL_FROM_DOCUMENTS` for buyers' copies, `EMAIL_REDIRECT_TO` to send every email to one test address (refused in production), a banner on every staging email, and `EMAIL_PROVIDER` (`mailgun`, `log` locally, or `none` to send nothing, with no EMAILED event for what wasn't sent). Voiding a document older than SRI checks offers the attestation (ADR-014, ADR-015).
- Every call to SRI is recorded in `sri_exchanges`, including checks that changed nothing and transport errors with SRI's body. The document page shows its progress to authorization; the app has its favicon, teal in production and blue elsewhere; the additional information field says what it's for (FR-DOC-12, FR-DOC-13, ADR-014).
- Who answered each call to SRI, SRI or the mock, is recorded with the host. The history marks each step (done, stopped by SRI, failed to send) and labels what the simulator answered, and a document the mock authorized says it never reached SRI. Every signed version of a document is kept in `document_versions`. The history no longer copies SRI's raw answer, which stays in `sri_exchanges` (FR-DOC-7, FR-DOC-12, FR-DOC-13, ADR-014).
- Invoice templates: save the form's client, lines, payments and additional information under a name, load one into a new invoice, remove it; with the Branding module (`DOCUMENT_TEMPLATES`). The buyer's email follows the old app's layout: greeting, a table of the document's facts with its authorization number, the attachments, the issuer's name and RUC (FR-MD-5, FR-DOC-11).
- `AUTH_SECRET`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION` and `EMAIL_FROM`.

### Fixed

- The RIDE draws a line under the last payment row (FR-DOC-10, ADR-015).
- A RIMPE negocio popular company can issue invoices: its legend, `CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE`, is added to the bundled factura XSD's pattern, which SRI publishes with the emprendedor legend only (ADR-013).
- Milestone 3's gate passed: an invoice authorized by SRI's test environment with a real certificate.
- The SRI schemas live in the repo as the files SRI publishes (`packages/core/assets/xsd/`), with a test that holds the embedded copies to them; the nota de crédito XSD is there for Milestone 4 (ADR-013).
- Credit notes can be created and corrected: from an authorized invoice of an identified buyer, each line held to what its invoice line has left in quantity and amount, with the invoice locked so two at once can't overspend it. A credit note SRI returned releases its share until corrected. Enabled per issue point with the Notas de crédito module (FR-SAL-8, FR-DOC-9, ADR-016).
- Credit note screens and RIDE: an invoice that SRI authorized offers "Nota de crédito", which opens a form listing each line with what is left to credit (a line can't go over it, said before sending); the credit note's page shows "Modifies" and the invoice lists its notes, with their status. A returned credit note is corrected on the same form. `issuingOptions` takes the document type; `allowed.credit` and `creditNoteDraft` feed the screens. The RIDE reads a nota de crédito from its authorized XML (the document it modifies and the reason, no payments), and the buyer's email job now covers it (FR-DOC-9, FR-DOC-10, FR-DOC-12).
- The nota de crédito builder: the XML of schema 1.1.0 with the original's number and date and the reason, rounded like the factura, signed and re-dated like it. The factura's header and tax blocks moved to a shared module (FR-SAL-8, ADR-013).
- A document can come from another: a credit note from its invoice, a guía optionally from one. `documents.related_document_id` has a composite foreign key (so it can't cross companies), is required for a credit note and refused for a factura, and never changes. The document detail returns the origin and what came from it (FR-SAL-8, FR-SAL-9).
- A registry of the document types SRI's engine issues (factura, nota de crédito, guía de remisión): XSD validation, the re-issue check and the buyer's email read it. The nota de crédito and guía schemas are embedded and validate; the RIMPE legend widening covers all three (FR-DOC-1, ADR-013).
- `OPERATOR_RUC` is required in production: Ficha v2.34's Anexo 26 makes "RUC Proveedor" mandatory on every invoice (ADR-013).
- Onboarding asks for the tax regime, so a RIMPE company's first invoice carries its legend; it stays editable in Configuración (FR-ONB-2).
