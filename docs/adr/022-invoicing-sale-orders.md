# ADR-022: Invoicing a Sale Order

## Status
Accepted

## Date
2026-11-09

## Context

FR-SAL-3 lets one order become many invoices, each picking lines and quantities up to what is uninvoiced, with the payment chosen at invoicing. FR-SAL-4 says an order is `INVOICED` when authorized invoices cover every line, a failed invoice keeps covering its quantities (it is corrected, not replaced), and only a voided invoice gives them back. FR-SAL-6 asks for the order-to-invoice-to-stock step to happen in one transaction, and FR-SAL-7 for the direct invoice and the order's to be the same pipeline. ADR-020 settled how an invoice holds, sells and returns goods; ADR-021 how an order holds them.

Questions the PRD leaves open:

- Where is "how much of a line an invoice covers" kept, and what counts?
- How does the order's hold become the invoice's?
- What is the order's discount worth on a partial invoice?
- How is an order's invoice corrected, and what does a void do to the order?
- Which module owns the workflow without a dependency cycle?

## Decision

**A link table, append-only and per revision** (`sale_order_invoice_lines`, migration 0045): order line, document, the document's revision, quantity. A correction adds rows for its new revision; the app role has no `UPDATE`. A line is covered by the rows whose revision is the document's current one and whose document isn't `VOIDED`. Failed documents (returned, rejected, unsent) count, as FR-SAL-4 says. The statuses are read with one join on `documents` in `sales/invoicing.ts`, so a status is never copied into the order's tables.

**The order's status follows its invoices** (`syncSaleOrder`, run in the transaction that changed a document's coverage or status): `INVOICED` once authorized invoices cover every line, `PARTIALLY_INVOICED` while anything is covered, `CONFIRMED` when nothing is. An invoice that covers the whole order but isn't authorized yet leaves it `PARTIALLY_INVOICED`. It runs when an invoice is created, when SRI authorizes one, and when one is voided. A correction can't change the status, since a corrected invoice is never authorized yet.

**The order's hold passes to the invoice** (`transferOrderHold`). For each product, what the order holds is released up to the invoiced quantity and the same quantity is held for the invoice, in the order's warehouse, not the issue point's. Release comes first, so the negative-stock rule sees the goods as free. What the order didn't hold (the company had no Inventario when it confirmed) is held for the invoice under the rule. The invoice's later steps are ADR-020's: authorization sells what it holds.

**A void gives everything back.** When an invoice made from an order is voided, ADR-020 returns its goods to stock, and `returnHoldToOrder` holds them again for the order, in the same transaction, whatever the negative-stock rule: SRI has already voided it, so the void must not fail. The order's coverage drops, and it moves back through `PARTIALLY_INVOICED` or `CONFIRMED`. Credit notes don't change the order: the invoice stays authorized, and the path for a credit is the credit note.

**A correction goes through the order.** `correctOrderInvoice` composes the invoice again from the order's lines, held to what the order has left not counting this invoice's own coverage, as the same row and sequential (FR-DOC-7). Its hold goes back to the order and is passed again with the new lines. The invoice's own correction (`correctInvoice`) refuses a document made from an order (`INVOICE_FROM_ORDER`): its lines come from the order, so quantities can't drift from what is linked.

**The order's prices are the invoice's.** A line is invoiced at its price, IVA code and product. Its discount is shared out by quantity and rounded so the parts add up: a part's discount is `round(D × covered_after ÷ Q) − round(D × covered_before ÷ Q)`, capped at its own value. Three invoices of one unit of a three-unit line with a 1.00 discount carry 0.33, 0.34 and 0.33.

**Payment is one method for the whole total.** The form sends a single payment without an amount, and core gives it the invoice's total from the lines it built, so a screen's estimate never has to match to the cent. Several payments can be sent through core, each with its amount (`PAYMENT_AMOUNT_REQUIRED` otherwise). The form offers one: more is rare for an order, and the direct invoice form has them.

**Where it lives.** `sales` owns orders, the link table, coverage and the order's status (`sales/invoicing.ts`); `inventory` owns the holds; `documents` owns the pipeline. The workflow that needs all three (`invoiceSaleOrder`, `correctOrderInvoice`, `saleOrderInvoices`, `orderInvoiceDraft` in `documents/order-invoice.ts`) lives in `documents`, which calls `sales` and `inventory` through their indexes, and `sales` never imports `documents`, so there is no cycle. `createInvoice` is `issueInvoice` in a transaction of its own: the same function runs in the order's transaction, with the link and the hold passing done before the send job is queued (FR-SAL-6, FR-SAL-7). The order is locked first and the document after, everywhere an order and a document are both locked.

**Idempotency.** A retry with the same key and payload returns its document before quantities are checked again, so a double click never fails with `ORDER_QUANTITY_EXCEEDED`.

## Consequences

### Positive

- Ten units invoiced 4 and 6 end `INVOICED` with stock right at every step, and a void or a correction leaves order, invoices and stock agreeing: the nightly check covers all of it.
- Nothing about coverage is stored twice: not in the order, not in the invoice, and holds are read from the ledger.
- One pipeline issues every invoice.

### Negative

- Reading coverage joins `documents` from the `sales` module. It is one query, commented as the exception to rule 3.
- An order's invoice can't have its lines edited in the invoice form, only through the order.
- A partly voided order's discount may not add up to the line's discount to the cent, since the parts are shared out by quantity when each is made. It never exceeds the line.

### Alternatives considered

- **Keeping an invoiced quantity on the order line:** rejected. It is a second copy that a void, a correction and a failed send would each have to keep in step.
- **Moving the hold only when SRI authorizes:** rejected. Between creating the invoice and the answer, another sale could take the goods, and a rejected invoice must keep its claim (ADR-020).
- **Hooks registered by `sales` for `documents` to call:** rejected. A module-level registry is duplicated across Next's bundles (CLAUDE.md mistake 22), and the explicit calls are easier to follow.
