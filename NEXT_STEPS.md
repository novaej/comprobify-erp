# Next Steps

Open work only: nothing finished stays here. Remove a step in the change that finishes it, and a milestone when its gate passes; `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Carried forward

- **Full review, before deploying (Milestone 10):** one manual QA pass of the whole system, run locally when everything is ready. It needs a written test script (a QA checklist, no code) covering every screen and flow by role (owner, admin, accounting, sales, purchasing, viewer, super admin), the happy paths and the edge cases (quota, SRI rejections, stock shortages, test and production mode, the twin, plans without a module). It takes in what earlier milestones left to walk through: the nightly stock check's log and the Compras and Solo lectura roles on purchasing and inventory; sale orders, invoicing in parts, the guía from an invoice, receivables and the go-live copy; bulk invoicing, its stack view and the platform queue page. Until then the owner hand-tests only when a milestone makes it mandatory.
- **Milestone 6:** the order's invoice form takes one payment for the whole total; core takes several (ADR-022). Move the payment block of the invoice form into a shared component and offer it on both.
- **Milestone 9 (also):** a minimum stock per product, so the dashboard's "low stock" (FR-REP-1) and the post-MVP stock-below-minimum notice (FR-NOT-2) mean below a threshold; today the dashboard lists stocked products with nothing available.
- **Milestone 9 (also):** retenciones issued and received in the tax summary (FR-REP-2) arrive with the document type, after the MVP; XLSX is not planned, since the CSV opens in Excel. The accountant's ZIP is built in memory, up to 65,535 files (no ZIP64): revisit if a month ever comes near it.
- **Not scheduled:** a CSV batch could also import the file as sale orders to invoice from the batch screen, on plans with Sales (`SALE_ORDERS`); today a CSV makes invoices directly. A CSV batch pays every invoice with one method; per-invoice payment columns are not offered.
- **Not scheduled:** a guía that leaves before its invoice (dispatch first): lines and quantities of the order, a shipped-so-far balance, and a way to tie the later invoice to it (ADR-023).
- **Milestone 4:** only the first guía recipient is searchable by client; the others take their invoice through the invoice search (ADR-017). The guía is not offered by plate catalogue or carrier directory.
- **Milestone 3:** certificate renewal (FR-ONB-3); twin reset.
- **Owner, with live email:** the Mailgun webhook for the buyer's copy (delivered, failed, complained), matched by the `document-id` variable each message carries (FR-DOC-11). Needs the Mailgun signing key and a public URL.
- **Milestone 10:** the 10,000-item bulk batch of NFR-PERF-3, and the caps (`BULK_LIMITS`: 50 per company, 150 overall) and the feeder's 5-second period tuned against what SRI accepts. At the defaults a lone company's batch moves at about 1 invoice a second (ADR-026, gate result), so 10,000 take about 2.5 hours; `pnpm test:bulk-gate` with `BULK_GATE_ITEMS=10000` is the run.
- **Milestone 9:** a page in the platform area to read a document's `sri_exchanges` for support, and a retention period for them (they grow with every authorization check).
- **Milestone 9 (also):** a re-issue skipped at a month boundary is only logged; tell the company too (FR-DOC-6, FR-NOT-2).
- **Owner, before go-live:** the real prices, pack sizes and plan limits in place of the placeholders (platform area: Precios, Planes), the operator's bank account (`BANK_TRANSFER_*`) and Payphone's production credentials (ADR-027, ADR-033).
- **Milestone 9 (also):** in Por facturar, a way to close a payment that needs no invoice (the operator's own company, a test), with a reason; until then, mark the operator's company complimentary.
- **Not scheduled:** the vehicle plate on invoices of transport operators, excluding taxis (Anexo 25, Ficha v2.33), if such companies sign up.
- **Not scheduled:** ownership transfer (PRD section 3). Today nobody can change or remove the owner.

## Milestone 9: Notifications, reports, admin

Gate: reports match seeded data; templates editable (PRD section 15). Pruning old notifications waits for the retention work (below), which needs a narrow exception to the no-delete rule.

- [ ] 7. The rest of the platform area. Done: the jobs view (queues, failed jobs with a retry, documents overdue at SRI across companies; FR-ADM-5). Left: the platform activity log, a document's SRI exchanges with their retention, and closing a payment that needs no invoice (the operator's own company)
- [ ] 8. Gate

## Upcoming milestones

- [ ] 10. Production readiness and cutover
- [ ] 11+. Post-MVP: retención, liquidación de compra and received XML import; public API, API keys, webhooks, MCP, OAuth, developer docs, Integración plans With webhooks, a `WEBHOOKS_DISABLED` switch so a restored copy of real data never calls the real endpoints it holds (CLAUDE.md mistake 13).

## Before agreements are switched on

- [ ] After the MVP, update the legal texts for the retention periods Milestone 9 introduces; nothing is edited before then. What the texts must say: the document, its signed and authorized XML, the authorization number and date, its timeline and one summary row per SRI exchange are kept for the tax period (the legally required record, 7 years per the Reglamento de Comprobantes de Venta, art. 41, to be confirmed by the accountant); the raw copy of SRI's answer (`sri_exchanges.raw`) is kept 90 days, being a technical duplicate used only for support; payment proofs are named and kept with the payment history, and a company removing one only hides it from its own view; the activity log is kept for the tax period; in-app notifications are kept 180 days; technical logs with IP addresses stay at 3 days (open question 2 in `docs/legal/review-notes.md`); Mailgun's delivery records follow its own policy. Define each period once, in one `RETENTION` object in core read by the pruning jobs, with a table in `docs/legal/`.
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
