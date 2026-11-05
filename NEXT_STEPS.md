# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Current: Milestone 3, SRI engine: factura

**Gate:** invoice authorized in the SRI test environment; fake-clock tests for 23:59, D+1 and month end; reception codes 43 and 70 handled.

Read PRD sections 5.8 and 6 and the Ficha Técnica v2.32 in `docs/reference/` before each step. Everything runs against a mock SRI and test certificates; the one step that reaches the real SRI is the owner's to run.

- [x] 1. Money and SRI catalogues: `decimal.js` with the rounding rules, and the Ficha's document types, identification types, taxes, IVA rates, payment methods and time units as typed lists in code, with their labels in the message files (ADR-012, NFR rule 14).
- [x] 2. Clients and products, basic: tenant tables under RLS, cédula and RUC check digits, consumidor final built in; list and form screens behind `CLIENTS` and `CATALOG` (FR-MD-1, FR-MD-2).
- [x] 3. Company settings: contribuyente especial, agente de retención, RIMPE; document types per issue point, needing `DOC_TYPE_*` (FR-PLAN-3); starting sequentials asked at go-live (FR-ONB-3, FR-ONB-5).
- [x] 4. Document core: documents, lines, events and sequentials (`FOR UPDATE`); the status machine with its generated trigger; the immutability trigger; the access key with Module 11 (FR-DOC-3, SRI rules 7 and 9).
- [x] 5. XML, XSD and signing: the factura builder in element order, `xmllint` validation before signing, the XAdES-BES signer (SRI rules 8 and 13; ADR-013).
- [x] 6. Creating an invoice: the FR-DOC-2 pipeline in one transaction (idempotency, entitlements, `DOCUMENT_QUOTA` never for the twin, totals and taxes, consumidor final cap, FR-DOC-9 validation) with the send job enqueued in it.
- [x] 7. SRI client and mock SRI: reception, authorization and Consulta de validez over SOAP; a mock server answering like SRI (RECIBIDA, DEVUELTA, codes 43, 45, 70) for tests and local work.
- [x] 8a. Send and authorize jobs: the retry calendar in Ecuador time, the deadline check, the 24-hour alert, fixed-clock tests at 23:59 and month end; the worker's SRI client from config, the mock always on in CI and the stack (FR-DOC-4, FR-DOC-5).
- [x] 8b. D+1 re-issue: yesterday's `SEND_FAILED` documents re-checked and, if SRI still lacks them, rebuilt with today's date, a new key and the same sequential, with `document_reissues`; month-crossing ones skipped and the company told; 45 stops it; fixed-clock tests on D+1 and at month end (FR-DOC-6).
- [x] 9a. Correction, manual re-issue and void: the same row and sequential, a new key only after the issue day; manual re-issue from D+2 or across a month after the date is confirmed; void only what Consulta de validez shows voided, never consumidor final, the user's attestation when SRI is down; an old key resolves to its document (FR-DOC-6, FR-DOC-7, FR-DOC-8).
- [x] 9b. RIDE and buyer email: the A4 RIDE with its Code 128 barcode from the authorized XML only; RIDE and XML emailed to the buyer on authorization, with resend (FR-DOC-10, FR-DOC-11).
- [x] 10a. Document screens: the invoice form with keyboard line entry and exact live totals, the list with filters and pages, the detail with the timeline, SRI's reasons, the RIDE and the XML (FR-DOC-2, FR-DOC-12, FR-UX-4). `CONSUMER_FINAL_MAX_AMOUNT` and `OPERATOR_RUC` reach `createInvoice` from the web runtime.
- [x] 10b. Pending documents and the actions: the pending screen grouping everything not yet final; correct (the form prefilled from the document), re-issue with the date confirmation, void with the attestation fallback, resend the email (FR-DOC-6 to FR-DOC-8, FR-DOC-11, FR-DOC-12). The web runtime gets an SRI client for voiding, with the same config and mock as the worker.
- [ ] 11. Gate, **run by the owner**: an invoice authorized by SRI's test environment with a real certificate, following a checklist prepared here; the fixed-clock and 43/70 tests in CI. The checklist includes the negocio popular RIMPE legend: the published factura XSD 2.1.0 refuses it, so send one to the test environment and settle it as ADR-013 says.

## Carried forward

- **Milestone 3:** certificate renewal (FR-ONB-3); twin reset.
- **Owner, with live email:** the Mailgun webhook for the buyer's copy (delivered, failed, complained), matched by the `document-id` variable each message carries (FR-DOC-11). Needs the Mailgun signing key and a public URL.
- **Milestone 8:** `DOCUMENT_QUOTA` counts the Ecuador calendar month for now; count it per billing period instead, with packs (FR-BILL-7).
- **Milestone 9:** the alerts that are only logged today become notifications: no SRI answer 24 hours after RECEIVED, code 45, a re-issue skipped at a month boundary, and "Factura … re-emitida con fecha …" (FR-DOC-5, FR-DOC-6, FR-NOT-2).
- **Milestone 9 (also):** email the companies on a plan when a module or a lower limit is scheduled to leave it, as with price changes (FR-BILL-6, FR-NOT-2); a page for the platform activity log (`platform_audit_events`).
- **Milestones 5 and 6:** go-live offers to copy master data from the twin (FR-ONB-5) once products, clients and suppliers exist.
- **Not scheduled:** CSV import and export of clients and products (FR-MD-1); saved invoice templates (FR-MD-5).
- **Not scheduled:** ownership transfer (PRD section 3). Today nobody can change or remove the owner.

## Upcoming milestones

- [ ] 4. Other SRI documents
- [ ] 5. Inventory and purchasing
- [ ] 6. Sales
- [ ] 7. Bulk invoicing
- [ ] 8. Billing
- [ ] 9. Notifications, reports, admin
- [ ] 10. Production readiness and cutover
- [ ] 11+. Post-MVP: retención, liquidación de compra and received XML import; public API, API keys, webhooks, MCP, OAuth, developer docs, Integración plans

## Before agreements are switched on

- [ ] Owner, or a lawyer, approves the legal texts and answers the open questions in [docs/legal/review-notes.md](docs/legal/review-notes.md); then set `AGREEMENTS_ENABLED=true` and the operator details.

## Hardening backlog

Hardening deferred by an earlier milestone. Add an item whenever a milestone puts one off, with where it's recorded. Milestone 10 works through the list, and its gate needs it empty or each remaining item accepted by the owner.

- [ ] TLS for managed Postgres connections, verified against DigitalOcean (`docs/deployment.md`).
- [ ] Slimmer Docker image: 1.45 GB with the full `node_modules` (`Dockerfile`).
- [ ] Browser-side Sentry, with the DSN from the server at runtime (ADR-008).
- [ ] Moderate audit findings in Sentry's dependencies (`glob`, `minimatch`). Recheck on each Sentry upgrade.
- [ ] Automated dependency updates (Renovate or Dependabot).
- [ ] Revisit a separate role for system context: `app.rls_system` is a setting, not a privilege (ADR-004).
- [ ] pg-boss index rebuilds: automatic `REINDEX` is off, so bloat reports need a manual owner task (ADR-005).
- [ ] Web shutdown: stop pg-boss and close the pool on `SIGTERM`, as the worker does.
- [ ] Refuse a TOTP code that was already used in its 30-second window. Better Auth accepts it twice; the integration tests show it (NIST SP 800-63B §5.1.4.2).
- [ ] A documented, tested rotation procedure for `CERT_ENCRYPTION_KEY` (PRD 9.3). Stored keys carry a `v1:` prefix for it.

## Before the old repositories are deleted

The owner will delete `comprobify` and `comprobify-web`, so this repo must not depend on them (`CLAUDE.md`).

- [ ] Once porting is done, remove the porting map: PRD Appendix A, the old-ADR table in `docs/adr/README.md`, and the read-only references in `CLAUDE.md`.
- [ ] Rewrite the remaining mentions of the old systems as self-contained history, and check that `git grep -E 'comprobify-web|\.\./comprobify|API ADR'` finds nothing that needs them.

## After the first Terraform deploy

- [ ] Owner makes `novaej/comprobify-erp` private. It stays public until then, because GitHub's free plan limits the permissions private repositories give the Terraform plan and apply workflows.

## Open questions

See [docs/PRD.md](docs/PRD.md), section 17.
