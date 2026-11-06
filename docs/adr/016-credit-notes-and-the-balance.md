# ADR-016: Credit Notes and the Balance of an Invoice

## Status
Accepted

## Date
2026-11-06

## Context

A nota de crédito (04) undoes part or all of an authorized invoice: a return, a discount after the sale, a correction SRI won't let a factura take. FR-SAL-8 says its quantities and amounts are limited by what the invoice has left, and that the limit is locked against concurrent creation.

The old system checked the balance and then inserted, with nothing between them. Two credit notes made together could each pass the check and together credit more than the invoice. It accepted that race; this one doesn't.

Questions the PRD leaves open:

- What is "the balance": the invoice's total, or each of its lines?
- Does a credit note SRI rejected keep its share of the balance?
- Does a credit note use the document quota?

## Decision

**The balance is kept per invoice line, in quantity and in amount.** A credit note's line says which line of the invoice it credits (`document_lines.source_position`). What a line has left is its quantity and its base minus what other credit notes hold of it. A credit note's line must fit both. The tax rate, code and name come from the invoice's line, so a credit note can't change the tax.

- A credit line's unit price defaults to the invoice's. A different price is allowed while the amount fits, so a discount after the sale is a credit of the same quantity at a lower price, which uses up that line's quantity. That is the cost of holding quantity and amount together; the alternative, a free amount on the invoice, would make the quantity meaningless.
- Several lines of one credit note may credit the same invoice line; they are added up before the check.
- Rounding can leave a cent on a line (three units at 3.333333 sum to 9.99 on a 10.00 base). The cent stays; nothing credits it.

**The invoice row is locked first.** `createCreditNote` takes `SELECT … FOR UPDATE` on the invoice before it reads the balance, so two credit notes for one invoice wait for each other, and the second sees what the first took. Other invoices are unaffected. A correction locks its own row, then the invoice's; creation never takes a credit note's lock, so the orders can't cross.

**What holds a share.** Every credit note of the invoice except those `RETURNED`, `NOT_AUTHORIZED` or `VOIDED`. One in flight (signed, sent, received, or unsent) holds its share, so authorization can't push the invoice over. A returned or rejected one holds nothing: it is corrected as the same row (FR-DOC-7) and has to fit what is left then, not what it held. Its own current content never counts against its correction. A void releases its share, since SRI no longer has the document.

**A credit note comes from an authorized invoice of an identified buyer.** Only an invoice (01) in `AUTHORIZED` can be credited: not an unsent one, a voided one, or another credit note. The buyer is the invoice's, copied from its snapshot, never from the live client. Consumidor final is refused (FR-DOC-9). The user must be able to see the invoice's issue point.

**The XML names the original as SRI sees it:** its type, its number as printed, and its issue date, the date of the version SRI authorized. The reason is `motivo`.

**Same pipeline, shared code.** A credit note goes through FR-DOC-2: idempotency, the `DOC_TYPE_04` feature, the issue point, the quota, the sequential, the key, the XML, the XSD before signing, the signature, then the rows and the send job in one transaction. The pieces both types need (field rules, quota, XSD check and signature, idempotency) are in `documents/compose.ts`. Correction is one function that takes the type's own composer, so an invoice and a credit note are corrected the same way. Sending, authorizing, re-issue and void need no change: they work on the stored XML.

**It uses the quota.** The quota counts documents created, and a credit note is one. The PRD says it for the guía and is silent here; counting every document is the rule that needs no exceptions.

## Consequences

### Positive

- Concurrent credit notes can't overspend an invoice; a test races two.
- A rejected credit note never blocks the invoice, and a correction can't claim more than is left.
- The balance is a query over rows already kept, with no counter to drift.

### Negative

- A credit note for a price reduction uses a line's whole quantity. Crediting units afterwards needs the balance of that line's quantity, which a price credit took. In practice: credit a discount on the line before the returns, or give the discount on a line of its own.
- A credit note rejected and never corrected holds no balance but still exists, with its number. There is no void for an unauthorized document (FR-DOC-8).
- Credit notes of an invoice serialize on its row; that is only a problem for a hot invoice, which doesn't happen.

### Alternatives considered

- **A balance on the invoice's total only:** rejected. It lets a credit note return what was never sold on a line.
- **A counter column on the invoice:** rejected. It can drift from the rows it counts, which is what the status rules (FR-DOC-3) avoid elsewhere.
- **Serializable transactions instead of a row lock:** rejected. They would retry the whole creation, signature included, and the lock is the same guarantee at the one place it matters.
