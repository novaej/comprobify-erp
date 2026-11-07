# ADR-019: Purchase Orders

## Status
Accepted

## Date
2026-11-07

## Context

FR-PUR-1 asks for purchase orders with the statuses `DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED → CLOSED`, `CANCELLED` from `DRAFT` or `SENT`, and lines from the catalogue. FR-DOC-3 and rule 17 require a status machine to be one TypeScript definition that generates both the database CHECK and the trigger. FR-PUR-2 (receiving) and FR-PUR-3 (the PDF to the provider) build on the order.

The PRD leaves these questions open:

- How is an order numbered? It isn't an SRI document, so it has no establecimiento, punto de emisión or sequential.
- What does a line cost: with IVA or without, and with a discount?
- How is a draft edited when the app role may not delete rows (rule 12)?
- Can an order that arrived in part be finished without the rest?

## Decision

**One number per company.** It comes from `tenant_counters`, one row per company and kind. The number is taken with an upsert that returns the new value, inside the order's transaction. The row stays locked until commit, so two orders created at once wait for each other and never share a number. A rollback gives the number back, so numbers have no gaps. The twin has its own counter, so its orders start at 1. The screen and the PDF show the number as `OC-000042` (`purchaseOrderNumber`). The table is generic: sale orders (Milestone 6) add their own kind.

**Lines are catalogue products at a cost without IVA.** A provider's price is the cost, so a line has no discount. Each line's IVA is the product's rate. Amounts are rounded as SRI rounds them (ADR-012): each line's base and IVA to cents, and the order sums the rounded lines. The form reuses the invoice's exact arithmetic, so the screen never disagrees with the saved order by a cent. A line keeps a snapshot of the product's code, name and unit, so the order reads the same after the product changes. A new order refuses an inactive provider (`PROVIDER_INACTIVE`) or an inactive product (`PRODUCT_INACTIVE`, naming the line). Each order names the warehouse its goods go to, and receiving puts them there.

**Editing a draft adds a revision.** The order has a `revision`, and its lines carry the revision they belong to. Saving a draft writes a new set of lines at `revision + 1`, and reads use only the order's current revision. The old lines stay, as a corrected invoice's do. The app role has no `UPDATE` on `purchase_order_lines` except on `received_quantity`, which receiving moves (FR-PUR-2). A CHECK keeps `received_quantity` between 0 and the ordered quantity.

**The status machine.** `PURCHASE_ORDER_TRANSITIONS` (`packages/db/src/schema/purchasing.ts`) is the one definition. It generates:

- the CHECK;
- the trigger, through `transitionTriggerBody`, now shared with documents;
- core's `assertPurchaseOrderTransition`.

A test compares the live trigger with the generated text. On top of the PRD's path:

- `SENT → RECEIVED`: everything arrives in one receipt.
- `PARTIALLY_RECEIVED → CLOSED`: the rest won't come, so the order is closed short and receives nothing more. The confirmation says so.
- `CANCELLED` stays as the PRD says, only before anything arrives. After that, closing is the way out, because received goods are already in stock.

`CLOSED` and `CANCELLED` are final.

Each change takes the order `FOR UPDATE` and checks the transition before writing, so two people acting at once get `INVALID_TRANSITION` instead of a silent overwrite. "Sent" is marked by hand for now: the provider may get the order by phone or in person. Step 8 adds sending it by email.

**Receiving** (FR-PUR-2, `purchasing/receipts.ts`). A receipt names some of the order's lines and how much of each arrived, and is one transaction:

1. It locks the order, which must be `SENT` or `PARTIALLY_RECEIVED` (`ORDER_NOT_RECEIVABLE` otherwise).
2. It refuses the whole receipt if any line gets more than is left (`RECEIPT_EXCEEDS_ORDER`). A line can't appear twice in one receipt.
3. For each line it raises the line's `received_quantity`. A good that tracks stock also gets a `PURCHASE_RECEIPT` movement through `applyMovement`. The movement goes into the order's warehouse, at the line's unit cost, with the receipt as its source, so the average follows ADR-018.
4. The order becomes `RECEIVED` when every line is complete, and `PARTIALLY_RECEIVED` otherwise.

Some lines are received without a movement:

- services;
- goods that don't track stock;
- any line, when the company no longer has the Inventario module.

The receipt line records whether it moved stock. Receipts and their lines are append-only, like the ledger. A mistake is corrected with a stock adjustment, never by editing the receipt. The receipt's date is the Ecuador day it was recorded.

**The PDF and the email** (FR-PUR-3, `purchasing/email.ts`, `purchasing/order-pdf.ts`). The PDF is drawn from the stored order. It is in Spanish and A4, like the RIDE:

- the company and its logo (while the plan has `RIDE_LOGO`, as on documents);
- the number and dates;
- the provider, and the delivery warehouse and its branch address;
- the lines, totals by IVA rate, and the notes.

A test company's PDF is stamped "PRUEBA: NO ES UN PEDIDO REAL", and its email subject starts with `[PRUEBAS]`. The order page shows the PDF. "Enviar por correo" takes one or more addresses, starting with the provider's. On a draft it also marks the order `SENT`: the status change and the `purchasing.email` job are in the same transaction (rule 10). A sent or partly received order can be emailed again.

The job re-reads the order, so it sends the order as it is then. It sends nothing if the order was cancelled meanwhile. It sends one message per address, from "Empresa via Comprobify" through the documents sender. Afterwards it records `emailed_at` and `emailed_to` on the order, unless email is off. A retry after a partial failure can send a copy twice; that is harmless, so the job doesn't track each address.

**Permissions and plan.** Orders need the `PURCHASE_ORDERS` feature (the Compras module). `purchasing.read` sees them, and `purchasing.manage` creates, edits, receives and moves them. Receiving needs no inventory permission: the purchasing role receives what it ordered. Core checks both. The pages and the menu only hide what the role or the plan doesn't allow.

## Consequences

### Positive

- Order numbers never repeat, even under concurrency, and have no gaps.
- An edited draft keeps its history without deleting anything.
- The database refuses an impossible status change even if code skips core.
- A receipt and its stock movements commit together, so the stock never shows goods the order doesn't, or the reverse.
- An emailed draft is sent and its email queued in one commit: never sent without its email, or emailed while still a draft.

### Negative

- Every edit of a draft adds a full set of lines. Drafts are edited a few times at most, so the growth is small.
- A partly received order can't be cancelled, only closed. A cancelled order means nothing ever arrived, and that stays true.
- A wrong receipt can't be undone. Goods received by mistake leave with a stock adjustment, and the order still shows them as received.

### Alternatives considered

- **A Postgres sequence per company:** rejected. Sequences are cluster objects, so this would mean one per tenant, they skip numbers on rollback, and RLS doesn't cover them.
- **`max(number) + 1`:** rejected. Two orders created at once would read the same maximum.
- **Lines as JSON on the order:** rejected. Receiving needs per-line quantities checked by the database, and the PDF and reports read lines as rows.
- **Updating lines in place while a draft:** rejected. Removing a line would need a `DELETE`, which rule 12 forbids.
