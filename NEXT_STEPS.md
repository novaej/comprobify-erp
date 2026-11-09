# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Current: Milestone 6, Sales

**Gate:** 10 units invoiced 4 + 6 → `INVOICED`, stock right; a `NOT_AUTHORIZED` invoice corrected through its order; a void returns its quantities (PRD section 15).

Read FR-SAL-1 to FR-SAL-10, FR-INV-1, FR-INV-2, FR-INV-4 and ADR-018 before each step. ADR-018 already settles when invoices move stock: reserved when the document is created, sold when SRI authorizes it, returned on void, and the credit note's return at the cost the sale went out at.

- [x] 1. Invoices move stock (ADR-020, migration 0043, `inventory/document-stock.ts`, `documents/stock.ts`): an invoice reserves its stocked lines in its issue point's warehouse when it is created, under the negative-stock rule; a correction re-reserves its new lines; authorization turns the reservation into a `SALE`; a void brings back what was sold and not already returned. A credit note can return its goods (`RETURN_IN`, FR-SAL-8) at the cost they left at, never more than the invoice sold; voiding it takes them out again.
- [x] 2. Sale orders (FR-SAL-1, FR-SAL-5, ADR-021, migration 0044, `sales/`): `DRAFT → CONFIRMED → PARTIALLY_INVOICED → INVOICED`, `CANCELLED` from DRAFT or CONFIRMED, CHECK and trigger generated (FR-DOC-3); a number per company; catalogue lines at a price; drafts and confirmed orders edited as revisions; confirming reserves, cancelling releases what is still reserved; list, form and detail screens.
- [x] 3. Invoicing an order (ADR-022, migration 0045, `documents/order-invoice.ts`; FR-SAL-3, FR-SAL-4, FR-SAL-6, FR-SAL-7): pick lines and quantities up to what is uninvoiced, and the payment; `sale_order_invoice_lines`; the order's reservation passes to the invoice in the same transaction as the document, quota and send job; `INVOICED` once authorized invoices cover every line; a failed invoice keeps its quantities and is corrected from the order; a void gives them back to the order with its reservation. The direct invoice calls the same function.
- [x] 4. The guía for a sale order (FR-SAL-9, ADR-023): from each of its invoices; the order lists them. Dispatch before invoicing is left until a client needs it.
- [ ] 5. Receivables, basic (FR-SAL-10): payments recorded by hand on an invoice (unpaid, partial, paid) and the aging report.
- [ ] 6. Loose ends: hide "Nota de crédito" once an invoice has nothing left to credit; go-live offers to copy master data from the twin (FR-ONB-5).
- [ ] 7. Gate: E2E for the order invoiced 4 + 6, the correction through the order and the void; stock right after each. Then the owner tries it locally.

## Carried forward
- **Milestone 4:** only the first guía recipient is searchable by client; the others take their invoice through the invoice search (ADR-017). The guía is not offered by plate catalogue or carrier directory.
- **Milestone 3:** certificate renewal (FR-ONB-3); twin reset.
- **Owner, with live email:** the Mailgun webhook for the buyer's copy (delivered, failed, complained), matched by the `document-id` variable each message carries (FR-DOC-11). Needs the Mailgun signing key and a public URL.
- **Milestone 8:** a switch that stops Payphone charges and callbacks in a restored copy of real data, as `EMAIL_REDIRECT_TO` does for email (CLAUDE.md mistake 13).
- **Milestone 8 (also):** `DOCUMENT_QUOTA` counts the Ecuador calendar month for now; count it per billing period instead, with packs (FR-BILL-7).
- **Milestone 9:** a page in the platform area to read a document's `sri_exchanges` for support, and a retention period for them (they grow with every authorization check).
- **Milestone 9 (also):** the alerts that are only logged today become notifications: no SRI answer 24 hours after RECEIVED, code 45, a re-issue skipped at a month boundary, and "Factura … re-emitida con fecha …" (FR-DOC-5, FR-DOC-6, FR-NOT-2).
- **Milestone 9 (also):** email the companies on a plan when a module or a lower limit is scheduled to leave it, as with price changes (FR-BILL-6, FR-NOT-2); a page for the platform activity log (`platform_audit_events`).
- **Not scheduled:** the vehicle plate on invoices of transport operators, excluding taxis (Anexo 25, Ficha v2.33), if such companies sign up.
- **Not scheduled:** CSV import and export of clients and products (FR-MD-1).
- **Not scheduled:** ownership transfer (PRD section 3). Today nobody can change or remove the owner.

## Upcoming milestones

- [x] 4. Other SRI documents
- [x] 5. Inventory and purchasing
- [ ] 6. Sales
- [ ] 7. Bulk invoicing
- [ ] 8. Billing
- [ ] 9. Notifications, reports, admin
- [ ] 10. Production readiness and cutover
- [ ] 11+. Post-MVP: retención, liquidación de compra and received XML import; public API, API keys, webhooks, MCP, OAuth, developer docs, Integración plans With webhooks, a `WEBHOOKS_DISABLED` switch so a restored copy of real data never calls the real endpoints it holds (CLAUDE.md mistake 13).

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
