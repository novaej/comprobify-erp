# ADR-023: The Delivery Guides of a Sale Order

## Status
Accepted

## Date
2026-11-09

## Context

FR-SAL-9 lets a guía de remisión start from an invoice, from a sale order, or on its own. ADR-017 built the first and the last. A guía travels with goods and names, as its supporting document, the invoice they were sold on; SRI allows that field to be empty, so a guía may also leave before the invoice does.

An order is invoiced in parts (ADR-022), so an order has many invoices, and each shipment matches an invoice's goods, not the order's.

## Decision

**A guía for an order goes with one of its invoices.** The order page lists its invoices and offers "Guía de remisión" on each one that isn't voided, which opens the guía-from-invoice form of ADR-017: the buyer, the goods and the supporting document come from the invoice, whose quantities are exactly what ships. The guía is `related_document_id` → the invoice, as always. An order has no guía of its own.

**The order's guías are derived, not stored.** They are the guías whose invoice belongs to the order (`saleOrderGuides`), and a guía's detail names its order through the same invoice. There is no link table: the invoice link of ADR-022 already says which order a guía belongs to, and a second link would be a copy to keep in step.

**Dispatch before invoicing is not built.** A guía that leaves before its invoice would need what this does not have: choosing lines and quantities of the order, a shipped-so-far balance so the same goods aren't sent twice, and a way to tie the later invoice to the guía (a guía's invoice is fixed when it is issued). A standalone guía, with the recipient and goods typed, covers it today. If a client needs it, it gets its own ADR.

## Consequences

- No migration and no new table: the guía's pipeline, RIDE and correction are untouched.
- A guía can't be made for goods that haven't been invoiced yet, other than as a standalone one.
- Several guías may go with one invoice, and nothing checks them against its quantities, since a guía carries no stock.
