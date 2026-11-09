# ADR-024: Receivables

## Status
Accepted

## Date
2026-11-09

## Context

FR-SAL-10 asks for basic receivables: an invoice's payment status (unpaid, partial, paid) recorded manually, and an aging report. Full collections management is after the MVP. Questions the PRD leaves open:

- What is owed, and since when?
- When is it due?
- How is a mistaken payment fixed, with no deletes?
- Where does the status live?
- How is the aging report cut?

## Decision

**An invoice is owed once SRI authorizes it**, for its total less the authorized credit notes made against it, less the payments that aren't voided. A credit note still waiting for SRI doesn't reduce it yet, and a voided invoice is not owed. The numbers come from the `documents` module through two functions (`receivableInvoice`, `receivableInvoices`), so `receivables` never reads its tables and `documents` never imports `receivables`.

**Payments are recorded by hand** (`invoice_payments`, migration 0046): an amount, a date from the invoice's issue date to today, a payment method in SRI's table (the one an invoice states its payments in), and an optional reference (a transfer or cheque number). A payment can't exceed what is owed (`PAYMENT_EXCEEDS_BALANCE`). The invoice is locked while it is recorded, so two payments at once can't both take the same balance (a test races two).

**A mistake is voided, never edited or deleted** (rule 12). The app role can update only `voided_at`, `voided_by` and `void_reason`, so a payment's amount, date and method can't be rewritten, and a voided payment stays listed, marked, with its reason. The balance ignores it.

**The status is worked out, not stored.** `PAID` when nothing is owed, `PARTIAL` when something was paid and something is left, `UNPAID` otherwise. It can never disagree with the payments, credit notes or voids that produce it.

**An invoice's due date is when its longest plazo ends.** The invoice's payment lines carry a term in days or months (FR-SAL-3's plazo); the due date is the issue date plus the longest, with months held to the end of a shorter month. An invoice that states no term is due on its issue date, since it was paid on the spot or is owed now. With several payment lines of different terms this is the date everything is due, which is the conservative reading for an aging report.

**The aging report is cut by days past the due date, as of today in Ecuador**: not yet due (including due today), 1 to 30, 31 to 60, 61 to 90 and over 90. Each bucket shows its count and balance, whatever the filter, and a bucket or a client filters the list. Invoices fully paid (or credited) leave it.

**It is for the `RECEIVABLES` feature** (module Ventas), `sales.read` to see and `sales.manage` to record or void. The invoice's page shows its own payments with the same rules.

## Consequences

### Positive

- The status, the balance and the report all come from the same records, so they agree.
- A payment is an auditable row: who, when, how, and who voided it and why.
- No new status machine: nothing to keep in step with the document's.

### Negative

- The report reads every authorized invoice and sums payments and credit notes for them. That is fine for an SMB's volume and is one place to optimize (an index and an open-invoices filter) when a company outgrows it.
- Payments aren't split across several invoices: a client paying two invoices with one transfer is two payments with the same reference.
- Late fees, reminders, statements and write-offs are not here; they belong to full collections management, after the MVP.

### Alternatives considered

- **A stored `payment_status` on the document:** rejected. It would be a copy that a payment, a void, a credit note's authorization and the invoice's own void would each have to update.
- **Using the invoice's own payment lines as what was paid:** rejected. They state how the invoice is to be paid, as SRI wants them, not what has arrived.
- **Editing a payment:** rejected. A voided row and a new one keep the history.
