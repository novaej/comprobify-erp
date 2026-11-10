# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Carried forward

- **Full review, before deploying (Milestone 10):** one manual QA pass of the whole system, run locally when everything is ready. It needs a written test script (a QA checklist, no code) covering every screen and flow by role (owner, admin, accounting, sales, purchasing, viewer, super admin), the happy paths and the edge cases (quota, SRI rejections, stock shortages, test and production mode, the twin, plans without a module). It takes in what earlier milestones left to walk through: the nightly stock check's log and the Compras and Solo lectura roles on purchasing and inventory; sale orders, invoicing in parts, the guía from an invoice, receivables and the go-live copy; bulk invoicing, its stack view and the platform queue page. Until then the owner hand-tests only when a milestone makes it mandatory.
- **Milestone 6:** the order's invoice form takes one payment for the whole total; core takes several (ADR-022). Move the payment block of the invoice form into a shared component and offer it on both.
- **Not scheduled:** a guía that leaves before its invoice (dispatch first): lines and quantities of the order, a shipped-so-far balance, and a way to tie the later invoice to it (ADR-023).
- **Milestone 4:** only the first guía recipient is searchable by client; the others take their invoice through the invoice search (ADR-017). The guía is not offered by plate catalogue or carrier directory.
- **Milestone 3:** certificate renewal (FR-ONB-3); twin reset.
- **Owner, with live email:** the Mailgun webhook for the buyer's copy (delivered, failed, complained), matched by the `document-id` variable each message carries (FR-DOC-11). Needs the Mailgun signing key and a public URL.
- **Milestone 8:** a switch that stops Payphone charges and callbacks in a restored copy of real data, as `EMAIL_REDIRECT_TO` does for email (CLAUDE.md mistake 13).
- **Milestone 8 (also):** `DOCUMENT_QUOTA` counts the Ecuador calendar month for now; count it per billing period instead, with packs (FR-BILL-7).
- **Milestone 10:** the 10,000-item bulk batch of NFR-PERF-3, and the caps (`BULK_LIMITS`: 50 per company, 150 overall) and the feeder's 5-second period tuned against what SRI accepts. At the defaults a lone company's batch moves at about 1 invoice a second (ADR-026, gate result), so 10,000 take about 2.5 hours; `pnpm test:bulk-gate` with `BULK_GATE_ITEMS=10000` is the run.
- **Milestone 9: CSV batches (FR-BULK-1), after the CSV import of clients and products (FR-MD-1), which it needs and shares its parser, row-numbered errors and upload screen with.** A file starts a batch in one of two ways. The default, on any plan with Bulk invoicing, is invoices: each row (rows with the same reference are the lines of one invoice) is validated up front, with errors by row number and nothing queued if the file is invalid, then made through the single-invoice pipeline (`bulk_batch_items.input` already holds a row). Only when the plan also has Sales (`SALE_ORDERS`) is there a second choice, to import the file as sale orders to invoice from the batch screen. Until then Bulk invoicing starts from sale orders only, so a company with the add-on but not Sales (the module is separate; Business and Enterprise have both) sees a locked page: either the CSV lifts that, or the module gets its dependency on Sales in the catalog.
- **Milestone 9:** a page in the platform area to read a document's `sri_exchanges` for support, and a retention period for them (they grow with every authorization check).
- **Milestone 9 (also):** the alerts that are only logged today become notifications: `BATCH_COMPLETED` (FR-BULK-3), no SRI answer 24 hours after RECEIVED, code 45, a re-issue skipped at a month boundary, and "Factura … re-emitida con fecha …" (FR-DOC-5, FR-DOC-6, FR-NOT-2).
- **Milestone 9 (also):** email the companies on a plan when a module or a lower limit is scheduled to leave it, as with price changes (FR-BILL-6, FR-NOT-2); a page for the platform activity log (`platform_audit_events`).
- **Not scheduled:** the vehicle plate on invoices of transport operators, excluding taxis (Anexo 25, Ficha v2.33), if such companies sign up.
- **Not scheduled:** CSV import and export of clients and products (FR-MD-1).
- **Not scheduled:** ownership transfer (PRD section 3). Today nobody can change or remove the owner.

## Upcoming milestones

- [x] 4. Other SRI documents
- [x] 5. Inventory and purchasing
- [x] 6. Sales
- [x] 7. Bulk invoicing
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
