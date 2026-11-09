# ADR-020: Invoices and Credit Notes Move Stock

## Status
Accepted

## Date
2026-11-09

## Context

ADR-018 set up the ledger in Milestone 5 and agreed with the owner that invoices start moving stock in Milestone 6. That ADR also set the timing: a document reserves its goods when it is created, sells them when SRI authorizes it, gets them back on void, and a credit note's return comes back at the cost the goods left at. All of it lands together so that a return can never add stock that never left.

Questions that were still open:

- From which warehouse does an invoice take its goods?
- What happens to the reservation when SRI returns or rejects the invoice, and when the invoice is corrected?
- The authorization happens in the worker, with no person and no actor. How does it move stock?
- What may a credit note bring back, and what does a void bring back after credit notes?
- What does voiding a credit note do?

## Decision

**The issue point's warehouse.** One warehouse per branch (FR-MD-4), so an invoice takes from the warehouse of its issue point's branch (`issuePointWarehouse`). Sale orders (step 2) choose their own warehouse.

**Every movement points at its document.** A document's movements carry `source_type = 'DOCUMENT'` and the document's id. What a document holds, sold or got back is the sum of its movements, read from the ledger (`inventory/document-stock.ts`). It is never kept in a second place that could disagree.

**The life of an invoice's goods:**

- **Created:** each line with a catalogue product that tracks stock is held (`RESERVATION`: reserved goes up, on hand stays) in the issue point's warehouse. Lines are added up per product and locked in product order, so two invoices with the same goods can't deadlock. The negative-stock rule applies (FR-INV-4): with `BLOCK`, holding more than is available (on hand minus reserved) refuses the invoice with `INSUFFICIENT_STOCK`, and the sequential rolls back with it. Lines typed by hand and services hold nothing.
- **Returned or rejected by SRI:** the goods stay held. The invoice is corrected, not replaced (PRD 5.8, FR-SAL-4), so it keeps its claim on them.
- **Corrected:** whatever the document still holds is released (`RELEASE`), and its new lines are held, in the correction's transaction. The new quantities face the rule with the old ones already let go.
- **Authorized:** what it holds leaves as a `SALE`: on hand and reserved both go down, at the average. No rule is checked: the goods were held, and SRI has already authorized it.
- **Voided:** what it sold and its credit notes didn't bring back comes back as a `RETURN_IN` at the cost the sale left at.

**Without the `INVENTORY` feature nothing is held**, and then nothing is sold or returned either, because the later steps only act on what the document's movements say. Plans can change between creation and authorization; the movements decide, not the plan in force when SRI answers.

**The worker moves stock without an actor.** `moveStock(tx, mover, input)` is `applyMovement` without the feature check, and `mover` is the tenant and the user, or null for the worker. The sale happens in `authorize`, in the same transaction as the AUTHORIZED transition and the buyer's copy. The void and the credit note's return use the same function.

**A credit note returns goods when asked** (FR-SAL-8, `returns_stock`, migration 0043). The form shows a switch only when the company has Inventario and the invoice still has goods out. The note's `RETURN` lines bring their goods back when SRI authorizes it, not before, so a rejected note returns nothing. They come into the warehouse the sale left from, at the sale's unit cost (its value over its quantity), and never more than the invoice sold minus what the invoice and its other notes already got back. `AMOUNT` lines bring nothing back. Asking for a return needs `INVENTORY` (`FEATURE_NOT_ENABLED`).

**A voided credit note takes its return back out** as an `ADJUSTMENT_OUT` at the average, whatever the negative-stock rule, since SRI has already voided it. Its movement points at the note.

**Concurrency.** The levels are locked before what is left to return is read, so a void and a credit note's authorization at the same moment can't both bring the same goods back. A product that stopped tracking stock since the sale is skipped: there is no level for it to return to, and the worker's transaction must not fail on it. Stopping tracking is refused while a level still holds or reserves stock (ADR-018).

## Consequences

### Positive

- Stock is right at every step, and the nightly check covers documents like any other movement.
- One ledger, read by source, answers "what does this invoice hold" and "what did it sell". There are no counters to drift.
- A rejected invoice can't lose its goods to another sale while it is being corrected.

### Negative

- An invoice SRI rejected and that nobody corrects keeps its goods held. Product stock pages show the reservation and link to the document, so it can be found and corrected.
- Turning `BLOCK` on means an invoice for goods not yet entered in Inventario is refused. A company starting out enters opening balances first, or allows negative stock.
- Voiding a credit note can take stock below zero. SRI has the final word on documents, so stock follows.

### Alternatives considered

- **Sell when the invoice is created:** rejected. A rejected invoice that is never sent would have taken goods that never left.
- **Hold nothing until authorization:** rejected. Between creation and SRI's answer another sale could take the same goods, and FR-SAL-2 asks for reservations.
- **A document-to-stock table next to the ledger:** rejected. It would be a second copy of what the ledger already says.
- **A `RETURN_OUT` type for a voided credit note:** rejected for now. `ADJUSTMENT_OUT` pointing at the note says the same thing without growing the PRD's list of types.
