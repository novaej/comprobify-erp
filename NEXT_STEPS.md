# Next Steps

Open work only: nothing finished stays here. Remove a step in the change that finishes it, and a milestone when its gate passes; `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Carried forward

- **Audit, left over (ADR-041):** the log now has the ACCOUNT and OPERATIONS categories and records voids, stock adjustments and counts, master data, collections, order cancellations, bulk batches and data exports. The stock count writes `stock.counted` (ADR-046). Not yet: retention per category (`RETENTION`; nothing prunes the log today); an operator's read of a company's operations log (the platform log records the lookup of SRI exchanges only).
- **Not scheduled:** a minimum stock per product, so the dashboard's "low stock" (FR-REP-1) and the post-MVP stock-below-minimum notice (FR-NOT-2) mean below a threshold; today the dashboard lists stocked products with nothing available.
- **Not scheduled:** retenciones issued and received in the tax summary (FR-REP-2) arrive with the document type, after the MVP; XLSX is not planned, since the CSV opens in Excel. The accountant's ZIP is built in memory, up to 65,535 files (no ZIP64): revisit if a month ever comes near it.
- **Not scheduled:** a CSV batch could also import the file as sale orders to invoice from the batch screen, on plans with Sales (`SALE_ORDERS`); today a CSV makes invoices directly. A CSV batch pays every invoice with one method; per-invoice payment columns are not offered.
- **Not scheduled, with the branch selector below:** which company a sign-in opens. Today a new session has no active company, so it opens the first by name (`chooseActiveOrganization`). Open the one the user last worked in instead (a `last_tenant_id` on the user, written by the switcher, and the same test-or-production side), and ask with a chooser only when there is none or it's no longer theirs (removed, or the company suspended). Someone with one company never sees the chooser. The chooser can carry the branch choice once the selector exists.
- **Not scheduled:** a working branch selector under the company switcher, stored on the session, with "Todas las sucursales" as an explicit choice. It sets defaults (the invoice form's issue point, the order forms' and stock screens' warehouse) and narrows the day-to-day lists and the dashboard; a banner says when one branch is chosen. It never narrows the tax summary or the accountant's export (the SRI declaration is per RUC); other reports stay company-wide unless a branch is picked in the report. A member whose issue points sit in one branch has it fixed; the twin keeps the choice by branch code. Needs its own ADR (documents and purchase orders derive their branch from the issue point and the warehouse; clients, products and providers are company-wide).
- **Not scheduled:** an email log for the owner and admin (a new `emails.read` permission): an `email_log` table written by the one wrapped send path (ADR-037), one row per attempt with the company in use, recipient, subject, rendered HTML and text, template, outcome (`sent`, `logged`, `skipped`, `failed` with the error) and the document or order it concerns; a list with search, filters and sorting, and a detail page showing the email in a sandboxed frame. Settle first: retention (bodies hold personal data: a period in `RETENTION`, `docs/legal/retention.md` and a prune with its own narrow exception on the pattern of ADR-038); not storing, or masking the links of, single-use emails (password reset, verification, invitation); a status column ready for the Mailgun webhook's delivered, bounced and complained answers; no resend button in the first version. Needs its own ADR.
- **When a fix ships:** remove the `auditConfig.ignoreGhsas` entry for GHSA-fc5q-39xc-vjpf from `pnpm-workspace.yaml` once picomatch has a patched release (ReDoS through extglobs; only build and file-watching tooling reaches it), and run `pnpm audit --prod --audit-level high`.
- **Not scheduled:** a guía that leaves before its invoice (dispatch first): lines and quantities of the order, a shipped-so-far balance, and a way to tie the later invoice to it (ADR-023).
- **Milestone 4:** only the first guía recipient is searchable by client; the others take their invoice through the invoice search (ADR-017). The guía is not offered by plate catalogue or carrier directory.
- **Owner, with live email:** the Mailgun webhook for the buyer's copy (delivered, failed, complained), matched by the `document-id` variable each message carries (FR-DOC-11). Needs the Mailgun signing key and a public URL.
- **Milestone 10:** the 10,000-item bulk batch of NFR-PERF-3, and the caps (`BULK_LIMITS`: 50 per company, 150 overall) and the feeder's 5-second period tuned against what SRI accepts. At the defaults a lone company's batch moves at about 1 invoice a second (ADR-026, gate result), so 10,000 take about 2.5 hours; `pnpm test:bulk-gate` with `BULK_GATE_ITEMS=10000` is the run.
- **Not scheduled:** prune in-app notifications older than 180 days, the other periodic duplicate in `docs/legal/retention.md`: it needs its own narrow exception on the pattern of ADR-038 and a `RETENTION` line.
- **Owner, before go-live:** the real prices, pack sizes and plan limits in place of the placeholders (platform area: Precios, Planes), the operator's bank account (`BANK_TRANSFER_*`) and Payphone's production credentials (ADR-027, ADR-033).
- **Not scheduled:** the vehicle plate on invoices of transport operators, excluding taxis (Anexo 25, Ficha v2.33), if such companies sign up.
- **Not scheduled:** keyset paging for the smaller lists still on OFFSET (sale and purchase orders, bulk batches, the catalog, the platform's log and notices), each when it grows (ADR-047).

## Milestone 10

Steps in order; the gate is in PRD section 15.

- [ ] Owner, GitHub settings (`docs/guides/git-flow.md`): **Dependabot alerts** and **security updates**, **secret scanning** and **push protection** on (Settings → Code security, the commands in `docs/guides/git-flow.md`); squash merges only with branches deleted after merge (merge commits and rebase are still on), and the release-tag ruleset (only `main`'s exists). `staging-plan` holds the full tokens: swap them for read-only ones (`docs/deployment.md`, step 4); `production-plan` gets read-only ones from the start.
- [ ] Hardening backlog (below): the code-only items, then the rest on staging.
- [ ] Security review, written up with each finding and its fix, rechecking the accepted audit findings (`docs/guides/git-flow.md`).
- [ ] Load test on staging: NFR-PERF-1, then the 10,000-item batch (NFR-PERF-3) and the bulk caps; `pnpm bench:signing` on the droplet into ADR-013.
- [ ] Backups and the restore drill on staging, as a runbook (email, webhooks and payments off in the restored copy, mistake 13).
- [ ] Data migration on production: `pnpm import:legacy` (ADR-049) from the final dumps, dry run then `--commit`, its reconciliation clean, then checked in the app (`docs/guides/legacy-import.md`), before the first release. Staging's import is done and checked; keep the dumps, the old `ENCRYPTION_KEY` and the `legacy_*_check` databases until then.
- [ ] Runbooks and the user guide.
- [ ] Owner: the production cluster, `production-infra` and `production` Environments, `PRODUCTION_INFRA_ENABLED=true`, then the cutover (`docs/deployment.md`, "Cutover"); delete the staging cluster.

## Upcoming milestones

- [ ] 10. Production readiness and cutover
- [ ] 11+. Post-MVP: retención, liquidación de compra and received XML import; public API, API keys, webhooks, MCP, OAuth, developer docs, Integración plans With webhooks, a `WEBHOOKS_DISABLED` switch so a restored copy of real data never calls the real endpoints it holds (CLAUDE.md mistake 13).

## Before agreements are switched on

- [ ] After the MVP, update the legal texts for the retention periods Milestone 9 introduces; nothing is edited before then. What the texts must say: the document, its signed and authorized XML, the authorization number and date, its timeline and one summary row per SRI exchange are kept for the tax period (the legally required record, 7 years per the Reglamento de Comprobantes de Venta, art. 41, to be confirmed by the accountant); the raw copy of SRI's answer (`sri_exchanges.raw`) is kept 90 days, being a technical duplicate used only for support; payment proofs are named and kept with the payment history, and a company removing one only hides it from its own view; the activity log is kept for the tax period; in-app notifications are kept 180 days; technical logs with IP addresses stay at 3 days (open question 2 in `docs/legal/review-notes.md`); Mailgun's delivery records follow its own policy. The periods are defined once in `RETENTION` (core) and tabled in `docs/legal/retention.md`; the texts follow that table.
- [ ] Owner, or a lawyer, approves the legal texts and answers the open questions in [docs/legal/review-notes.md](docs/legal/review-notes.md); then set `AGREEMENTS_ENABLED=true` and the operator details.

## Hardening backlog

Hardening deferred by an earlier milestone. Add an item whenever a milestone puts one off, with where it's recorded. Milestone 10 works through the list, and its gate needs it empty or each remaining item accepted by the owner.

- [ ] pg-boss index rebuilds: automatic `REINDEX` is off, so bloat reports need a manual owner task (ADR-005).

## Before the old repositories are deleted

The owner will delete `comprobify` and `comprobify-web`, so this repo must not depend on them (`CLAUDE.md`).

- [ ] Copy what is still to come from them into this repo first: the public API documentation site's content (Milestone 11+). The Terraform, deploy and workflow patterns are in (ADR-048).

## After the first Terraform deploy

- [ ] Owner renames the repository to `comprobify` once the previous system's `comprobify` repository is deleted (ADR-050); the image name follows `github.repository`.
- [ ] Owner makes `novaej/comprobify-erp` private. It stays public until then, because GitHub's free plan limits the permissions private repositories give the Terraform plan and apply workflows.

## Open questions

See [docs/PRD.md](docs/PRD.md), section 17.
