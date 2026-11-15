# ADR-042: An order's invoice is issued at its warehouse's issue point

## Status

Accepted. It adds a constraint to ADR-021 and ADR-022; their other rules stand.

## Date

2026-11-15

## Context

A sale order holds its goods in one warehouse (ADR-021), and the invoice made from it takes them from that warehouse "not the issue point's" (ADR-022). Nothing tied the two together, so goods held in Matriz could be invoiced under an issue point of Norte. The model is one warehouse per branch and one branch per issue point, and the RIDE prints the issuing establishment's address. An invoice from Norte that empties Matriz therefore says the goods left Norte, and moving goods between establishments needs a guía de remisión that nothing here records. Per-warehouse figures stop matching per-establishment sales.

## Decision

- The issue point of an invoice made from a sale order must be one of the **branch of the order's warehouse**. Core refuses any other with `ISSUE_POINT_WAREHOUSE_MISMATCH`. It is checked where the invoice is made (`invoiceOrderIn`, which a manual invoice and a batch item both pass through) and, for a bulk batch, up front for every order (`startOrderBatch`), so a batch is refused whole instead of failing item by item.
- The **invoice-from-order form** lists only the issue points of that warehouse's branch, and says so when the company has none enabled for invoices there.
- The **bulk invoicing page** lists the orders held in the chosen issue point's warehouse. Changing the issue point changes the list; "all that match" follows the same filter. One batch is one issue point and so one warehouse: orders of another warehouse go in their own batch.
- Invoices made without an order already leave from their issue point's warehouse (ADR-020), so the two paths now agree. A CSV batch, which has no orders, is unchanged.

## Consequences

- No schema change.
- A company that wants to invoice from one establishment while goods ship from several needs real stock transfers between warehouses, which are not built. Until then each warehouse's orders are invoiced at its own issue point.
- A correction of an order's invoice keeps its issue point, so it passes the rule it was made under.

## Alternatives considered

- Allow it with a warning: leaves the inconsistent invoice possible and puts the burden on the person.
- Move the stock to the issue point's warehouse when invoicing: a silent transfer with no document, and it would undo the reservation the order made.
