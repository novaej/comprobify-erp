# ADR-043: Twin reset

## Status

Accepted.

## Date

2026-11-18

## Context

The PRD glossary defines a twin reset: a test copy's data (transactions and master data) is deleted and the copy re-created fresh, with branches and issue points from the real company, its master data copied from it and the numbering back to 1. Owner or Admin only, with a typed confirmation, logged. FR-ONB-5 names it as the one way data moves from the real company to its test copy after go-live. It is also the one exception to "no hard deletes" (CLAUDE.md rule 12): the app role has no `DELETE` grant on application tables, and nothing else may get one.

## Decision

**One database function does the deleting.** `app_reset_twin(tenant)` is `SECURITY DEFINER`, owned by the owner role (which may delete) and executable by the app role only. It refuses unless it runs in system context (`app.rls_system`, so the call is logged with its reason) and the tenant is in `TEST` mode with a `twin_of`. It locks the tenant row, deletes the copy's rows child-first in the order its foreign keys need, and re-creates every `document_sequences` row at the default of 1. The app role still has no `DELETE` on any table.

**What goes:** documents and everything hanging from them (lines, payments, events, re-issues, versions, SRI exchanges, collections), sale and purchase orders with their lines and receipts, bulk batches, the stock ledger and levels, products, clients, providers, templates, and the order counters.

**What stays:** the tenant row and its settings, members and their issue-point restrictions, branches, issue points with their document types, and warehouses. These are already mirrors of the real company's: every settings and members change writes both by code (ADR-039, FR-ROLE-2). Re-creating them would only change their ids. The certificate and logo stay, and so do the plan and subscription rows, notices (stored on the real company) and the activity log, which is append-only and records the reset itself.

**Core refills it in the same transaction.** `resetTwin` (in `tenancy/twin-reset.ts`) checks `organization.reset_twin` (Owner and Admin). The typed confirmation is the company's RUC. It calls the function, then copies the real company's active master data to the copy with the go-live copy (`copyMasterData`, the other direction), with templates moved to the copied clients and products. It writes `organization.twin_reset` on the real company with what was copied. A failure anywhere rolls back the whole reset.

**Where:** a **Copia de pruebas** card on Empresa, for those with the permission, from either company of the pair. Its dialog says what goes and what stays, and asks for the RUC.

## Consequences

- Jobs already queued for a deleted document find nothing when they run and stop, since handlers re-fetch by id (NFR-JOB-1). A batch's feeder finds no batch.
- Notices about the copy's documents stay in the list and lead to a page that no longer exists.
- A test copy keeps what the real company has, not what it had at creation: a branch added later is there, and a twin reset never adds or removes one.
- The function is the only place a row of a tenant table is deleted. A table added later is not reset until it is listed there. The integration test resets a copy that has used invoices, master data and counters.

## Alternatives considered

- **`DELETE` grants for the app role, used only by this code.** Rejected: any bug could then delete any company's history, and rule 12 is enforced by grants, not by care.
- **Mark the rows inactive instead of deleting them.** Rejected: codes and identifications are unique per tenant, so the master data copied back would clash with the hidden rows, and the sequences can't start again while old documents hold the numbers.
- **A new twin tenant, retiring the old one.** Rejected: memberships, certificates, subscriptions and the active tenant on every session point at the twin's id, and switching them all is a larger and riskier change than emptying it.
