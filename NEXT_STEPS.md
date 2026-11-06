# Next Steps

Open work only. Tick steps as they land. When a milestone's gate passes, remove its section: `CHANGELOG.md` and git keep the history. Requirements and gates are in [docs/PRD.md](docs/PRD.md), section 15.

## Current: Milestone 4, Other SRI documents

**Gate:** each type authorized in the SRI test environment with its RIDE (PRD section 15). Types are 04 nota de crédito and 06 guía de remisión (FR-DOC-1); nota de débito and retención come after the MVP.

Read FR-DOC-1, FR-SAL-8 and FR-SAL-9 and the Ficha annexes for each type (Anexo 3 has the 1.1.0 formats) before each step. The factura pipeline is the pattern: builder, XSD before signing, signer, jobs, RIDE. The rules for a new type are in `docs/guides/coding-guidelines.md`.

- [x] 1. The type registry (FR-DOC-1): `sri/document-types.ts` holds each type's root, version, schema and label; XSD validation, the re-issue check and the buyer's email read it instead of assuming 01. The builder and RIDE mapper join the entry in steps 3 to 7. The schemas are generated from `assets/xsd/`, and the RIMPE widening covers all three.
- [x] 2. Links between documents: `documents.related_document_id` (migration 0034) points a credit note at its invoice and a guía optionally at one, through a composite foreign key so it can't leave the company. A credit note must have one and a factura can't; the link never changes (the immutability trigger). `getDocument` returns the origin and what came from it. The origin's number, date and type travel in the XML (`numDocModificado`, `fechaEmisionDocSustento`) from step 3.
- [x] 3. Nota de crédito builder: `buildNotaCredito` writes XSD 1.1.0's elements in order (its own line names, no unit, payments or tip; `valorModificacion` is the credited total) with the factura's rounding. The header, tax blocks and additional information the two share moved to `sri/document-parts.ts`. Tested against the XSD, signing and re-dating.
- [x] 4. Nota de crédito creation: `createCreditNote` and `correctCreditNote` through the FR-DOC-2 pipeline (`documents/credit-note.ts`, shared pieces in `documents/compose.ts`); only from an `AUTHORIZED` invoice of an identified buyer; a reason; each line held to what its invoice line has left in quantity and amount, with the invoice row locked so two at once can't overspend it; `creditBalance` for the form. Migration 0035. The type is offered at issue points (ADR-016). Until step 5 a credit note has no RIDE, so the buyer's email job skips it.
- [x] 5. Nota de crédito screens and RIDE: create it from the invoice's page (`documents/[id]/credit-note`), correct it on the same form, the detail shows "Modifies" and the notes of an invoice, the RIDE and buyer's email from the authorized XML (FR-DOC-9, FR-DOC-10, FR-DOC-12, FR-UX-2). Known gap: the invoice keeps offering the button after everything is credited; the form then has nothing left to pick.
- [ ] 6. Guía de remisión builder and XSD: the guía's own XSD (**the owner downloads it from SRI into `packages/core/assets/xsd/`**), the builder, and the rules of FR-SAL-9: transportista, plate, start date not before the issue date (SRI error 82), departure address, recipients each with an optional supporting document.
- [ ] 7. Guía creation, screens and RIDE: from an invoice or standalone, consuming quota (FR-SAL-9); the sale-order origin waits for Milestone 6. Its RIDE from the authorized XML.
- [ ] 8. Gate, **run by the owner**: one nota de crédito and one guía authorized by SRI's test environment, following a checklist prepared here; the mock covers both types in CI.

Carried to later milestones: the optional **stock return** on a credit note (`RETURN_IN`, FR-SAL-8) needs the inventory ledger, so it lands in Milestone 5; the guía from a **sale order** lands in Milestone 6.

## Carried forward

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

- [ ] 4. Other SRI documents (planned above)
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
