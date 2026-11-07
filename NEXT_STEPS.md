# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Current: Milestone 5, Inventory and purchasing

**Gate:** a receipt and an adjustment reflected in stock levels and cost; the nightly check finds no drift (PRD section 15).

Read FR-MD-3, FR-MD-4, FR-INV-1 to FR-INV-6 and FR-PUR-1 to FR-PUR-3 before each step. Decided with the owner: **weighted average cost, kept per warehouse** (PRD open question 6), and invoices and the credit note's stock return start moving stock in **Milestone 6**, together with reservations, so a return can't add stock that never left.

- [x] 1. The ledger (ADR-018, migration 0037): `stock_movements` (append-only, a trigger refuses `UPDATE`) and `stock_levels` (on hand, reserved, value; one row per product and warehouse), movement types generated into the CHECK, and the company's negative-stock rule (block by default, FR-INV-4). One core function, `applyMovement`, locks the level row, refuses what the rule forbids, writes the movement and the level in the caller's transaction. Average cost as value over quantity, so rounding never drifts. Unit tests for the cost rules; integration for concurrency, the rule and isolation.
- [x] 2. Adjustments and opening balances (FR-INV-3, `inventory/adjustments.ts`, migration 0038): an adjustment in or out with a reason (in at a cost, out at the average); an opening balance only before a product's first movement in that warehouse; CSV import of opening balances. A product's `tracksStock` can't be turned off while it holds stock (FR-INV-6).
- [x] 3. Inventory screens (`inventory/queries.ts`, `apps/web/.../inventory/`): stock levels per warehouse, a product's movements, the adjustment dialog, the opening import, the valuation report (FR-INV-5), and the negative-stock setting. Gated by `INVENTORY` and `inventory.read` / `inventory.adjust`.
- [x] 4. The nightly check (FR-INV-2, `inventory/verify.ts`, the `inventory.verify` job): a job in Ecuador time that compares each level with its ledger, quantity and value, and logs drift as an alert (notifications arrive in Milestone 9).
- [ ] 5. Providers (FR-MD-3): the client's identity shape plus payment terms, with their screens. Retention codes wait for retenciones (post-MVP).
- [ ] 6. Purchase orders (FR-PUR-1): `DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED → CLOSED`, `CANCELLED` from DRAFT or SENT, with the CHECK and trigger generated from the TypeScript transitions (FR-DOC-3); a number per company; lines from the catalogue; screens.
- [ ] 7. Receiving (FR-PUR-2): full or partial per line, never more than is left; a `PURCHASE_RECEIPT` movement per stocked line in the same transaction, updating the average; the order's status follows. Services are received without a movement.
- [ ] 8. The order as a PDF, emailed to the provider (FR-PUR-3, optional), through a job enqueued with the change.
- [ ] 9. Gate: E2E for an opening balance, a receipt and an adjustment with the levels and cost they leave; the nightly check over seeded data finds no drift. Then the owner tries it locally.

## Carried forward

- **Milestone 4:** the optional **stock return** on a credit note (`RETURN_IN`, FR-SAL-8) needs the inventory ledger, so it lands in Milestone 5. A credit note line is a return or an amount (ADR-016), so a stock return attaches to return lines only.
- **Milestone 4:** the invoice keeps offering "Nota de crédito" after everything is credited; the form then has nothing left to pick. Hide the button once no line has quantity or amount left.
- **Milestone 4:** only the first guía recipient is searchable by client; the others take their invoice through the invoice search (ADR-017). The guía is not offered by plate catalogue or carrier directory.
- **Milestone 6:** the guía from a **sale order** (FR-SAL-9).
- **Milestone 3:** certificate renewal (FR-ONB-3); twin reset.
- **Owner, with live email:** the Mailgun webhook for the buyer's copy (delivered, failed, complained), matched by the `document-id` variable each message carries (FR-DOC-11). Needs the Mailgun signing key and a public URL.
- **Milestone 8:** a switch that stops Payphone charges and callbacks in a restored copy of real data, as `EMAIL_REDIRECT_TO` does for email (CLAUDE.md mistake 13).
- **Milestone 8 (also):** `DOCUMENT_QUOTA` counts the Ecuador calendar month for now; count it per billing period instead, with packs (FR-BILL-7).
- **Milestone 9:** a page in the platform area to read a document's `sri_exchanges` for support, and a retention period for them (they grow with every authorization check).
- **Milestone 9 (also):** the alerts that are only logged today become notifications: no SRI answer 24 hours after RECEIVED, code 45, a re-issue skipped at a month boundary, and "Factura … re-emitida con fecha …" (FR-DOC-5, FR-DOC-6, FR-NOT-2).
- **Milestone 9 (also):** email the companies on a plan when a module or a lower limit is scheduled to leave it, as with price changes (FR-BILL-6, FR-NOT-2); a page for the platform activity log (`platform_audit_events`).
- **Milestones 5 and 6:** go-live offers to copy master data from the twin (FR-ONB-5) once products, clients and suppliers exist.
- **Not scheduled:** the vehicle plate on invoices of transport operators, excluding taxis (Anexo 25, Ficha v2.33), if such companies sign up.
- **Not scheduled:** CSV import and export of clients and products (FR-MD-1).
- **Not scheduled:** ownership transfer (PRD section 3). Today nobody can change or remove the owner.

## Upcoming milestones

- [x] 4. Other SRI documents
- [ ] 5. Inventory and purchasing
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
