# ADR-041: One activity log, two categories

## Status

Accepted

## Date

2026-11-15

## Context

The company's Actividad log (FR-NOT-4) recorded sign-ins, people and roles, settings, certificates, going live, plan and payments, but not what the business did with its money, stock and records. FR-NOT-4 also names voids and stock adjustments, which were traceable only in a document's timeline and the stock ledger. Adding every transaction to the same flat list would bury the account and setup events within days, and the two kinds are read by different people: the owner for security, the accountant or an auditor for the business's own actions.

## Decision

- **One table (`audit_events`), two categories.** `ACCOUNT` is who the company is and who can do what; `OPERATIONS` is what the business did. The category is **derived from the list an action sits in** (`ACCOUNT_AUDIT_ACTIONS`, `OPERATIONS_AUDIT_ACTIONS`), never stored, so it can't drift from the action. `AUDIT_ACTIONS` is both lists and still generates the CHECK.
- **One permission per category.** `audit.read` reads ACCOUNT; `audit.operations.read` reads OPERATIONS. Owner and Admin have both; the Accountant has only OPERATIONS (it no longer reads sign-ins and role changes); other roles have neither, and see only their own acts (both categories) instead of nothing: `listAuditEvents` narrows to the person's own events when they hold neither permission, and anyone who can read may ask for `mine` to narrow the whole log to theirs. `listAuditEvents` takes an optional category and refuses one the person can't read; with none it returns what they may.
- **What is recorded.** Who did what and when, for actions that change money, stock, identity, access or take data out: a document voided; stock adjustments, opening balances and their CSV import; create, update, activate or deactivate and CSV import of products, clients and providers; a purchase or sale order cancelled; a sale order invoiced; a collection recorded or voided; a bulk batch started; data exported (the clients, products, stock valuation and report CSVs, and the accountant's ZIP). Not recorded: reads, document issuing (it has its own timeline), order edits.
- **Detail rules.** A record whose values aren't personal (a product) stores each changed field's value before and after. A record that holds other people's data (a client's or provider's email, phone, address) stores only the **names of the fields that changed**. An import is one entry with counts, never one per row.
- **Where.** An operations event is recorded in the company in use: testing and the real company never mix in the log. ACCOUNT events keep their rule: they are recorded on the real company and shown from the test copy too.
- Entries are written in the transaction of the change, as before, and the table stays insert-only for the app role.

## Consequences

- New actions need a migration (the CHECK); 0069 adds the twenty-two OPERATIONS ones.
- The activity page shows tabs ("Todo", "Cuenta y configuración", "Operaciones") for those who can read both; a person with one permission sees that category only.
- Retention is not split by category yet (nothing prunes the log); when it is, `RETENTION` can take a line per category.
- The domain histories (document events, the stock ledger, order revisions) stay the authoritative record of their objects; the log is the index of who acted.

## Alternatives considered

- Two tables, one per audience: two migrations, pages and retention rules to answer "what happened to this company?", with events that don't belong clearly to either.
- A stored `category` column: one more fact to keep in step with the action list.
- Logging every transaction: it would hide the events that matter and duplicate the object histories.
