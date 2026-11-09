# ADR-021: Sale Orders

## Status
Accepted

## Date
2026-11-09

## Context

FR-SAL-1 asks for sale orders with the statuses `DRAFT → CONFIRMED → PARTIALLY_INVOICED → INVOICED`, `CANCELLED` from `DRAFT` or `CONFIRMED`, and lines from the catalogue. FR-SAL-2 says confirming reserves stock and cancelling releases what is still reserved. FR-DOC-3 and rule 17 require the status machine to be one TypeScript definition that generates the CHECK and the trigger. ADR-020 settled how invoices hold, sell and return goods; an order holds goods before an invoice exists, so it has to hold them in a way an invoice can take over (step 3 of Milestone 6).

Questions the PRD leaves open:

- Is the client required? Invoices allow consumidor final.
- Which warehouse does an order hold goods in, and what does the order's price mean?
- Can a confirmed order be edited?
- What moves an order back from `INVOICED` when an invoice is voided?

## Decision

**The order is the purchase order's twin** (ADR-019): a number per company from `tenant_counters` (kind `SALE_ORDER`, shown as `PV-000001`), lines from the catalogue with the code, name, price and IVA as they were when saved, and an edit that adds a new revision of the lines instead of deleting rows (rule 12; the app role has no `UPDATE` on `sale_order_lines`).

**A null client is consumidor final**, as on an invoice. A client, when given, must be active.

**Prices are the invoice's.** A line has a quantity, a unit price (the catalogue's, which the line may change) and a discount, and is rounded as SRI rounds a factura (`lineAmounts`, `documentTotals`, ADR-012), so an order's total is the total of the invoice made from all of it.

**One warehouse per order**, chosen on the form: goods are held in it and invoices made from the order leave from it. Invoices made without an order leave from their issue point's warehouse (ADR-020).

**Status machine** (`SALE_ORDER_TRANSITIONS`, generated into the CHECK and the trigger, and a test compares the migration's trigger with the definition):

- `DRAFT → CONFIRMED, CANCELLED`
- `CONFIRMED → PARTIALLY_INVOICED, INVOICED, CANCELLED`
- `PARTIALLY_INVOICED → CONFIRMED, INVOICED`
- `INVOICED → PARTIALLY_INVOICED, CONFIRMED`

The last two go backwards on purpose: a voided invoice gives its quantities back to the order (FR-SAL-4), which is a move back. They are defined now so Milestone 6 step 3 needs no second trigger. Cancelling is only from `DRAFT` and `CONFIRMED`, as FR-SAL-1 says: once something has been invoiced, the path is a credit note.

**Holding goods.** Confirming holds each stocked line's goods in the order's warehouse as a `RESERVATION` whose source is the order (`source_type = 'SALE_ORDER'`, migration 0044), under the negative-stock rule (`INSUFFICIENT_STOCK` rolls the confirmation back, and the order stays a draft). Cancelling a confirmed order releases what it still holds. A draft holds nothing. Without the `INVENTORY` feature, and for services and goods that track no stock, nothing is held. It uses the same functions as invoices (`reserveDocumentStock` and `releaseDocumentStock` take the source type), so what an order holds is read from the ledger, never kept twice.

**A confirmed order can be edited** until something is invoiced from it (FR-SAL-5): in one transaction its goods are released, the lines get a new revision, and the new quantities are held. If they don't fit, nothing changes. Step 3 refuses the edit once an invoice covers any line.

**Permissions.** The `SALE_ORDERS` feature (module Ventas), `sales.read` to see and `sales.manage` to change.

## Consequences

### Positive

- An order's reservation shows in the product's movements and in its `reserved` figure, and the nightly check covers it like any other movement.
- The same functions hold goods for an order and an invoice, so passing the hold from one to the other (step 3) is a release and a reservation in one transaction.
- Orders and purchase orders look and work alike, from the list to the CHECK and trigger.

### Negative

- A confirmed order that nobody invoices or cancels keeps its goods held. Product stock pages show the reservation and link to the order.
- The backward transitions are allowed by the trigger before any code uses them. Core is the only caller, and its tests cover them when step 3 lands.

### Alternatives considered

- **Require a client:** rejected. Counter sales are consumidor final, and the order has to lead to the same invoices a direct sale does.
- **Hold goods from the draft:** rejected. A draft is a quote that may never happen, and holding blocks other sales.
- **Cancelling a partly invoiced order:** rejected for the MVP. What is invoiced stays invoiced; the rest of the order is closed by invoicing it or by crediting.
