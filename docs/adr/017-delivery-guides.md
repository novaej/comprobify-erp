# ADR-017: Delivery Guides (Guía de Remisión)

## Status
Accepted

## Date
2026-11-06

## Context
A guía de remisión (type 06) moves goods and states no money. It has a carrier, a plate, transport dates, a departure address and one or more recipients, each with its goods and an optional supporting document. Its XSD has no issue date, no buyer and no taxes, so it does not fit the columns an invoice uses.

## Decision
- **The signed XML is the record of the move.** The carrier, plate, dates and recipients are not copied into columns. The detail page, the RIDE and the correction form read them back from the XML (`rideData`, `Transport`). Nothing can drift from what SRI received.
- **The row still looks like a document.** The first recipient is the row's "buyer" snapshot so the list and its search work; the totals are `0.00` and the tax totals empty. One `document_lines` row per item moved keeps the goods queryable for the stock work in Milestone 5, with price and tax at zero.
- **It may name an invoice.** `related_document_id` points at it (any invoice that was not voided; a guía often travels before the invoice is authorized). `guideFromInvoice` starts the form from that invoice's buyer, goods and supporting document. A guía can also stand alone.
- **Dates are SRI's rule, said before signing.** The transport starts on or after the issue day (SRI error 82) and ends on or after it starts: `TRANSPORT_START_BEFORE_ISSUE` and `TRANSPORT_END_BEFORE_START`.
- **The guía's date is its transport start.** The XSD has no emission date, so SRI reads it from `fechaIniTransporte` and refuses a key built on another day (error 58: the date is not part of the access key). The key and `documents.issue_date` carry the start date, which may be a future day. Found in the first SRI test run, when a guía starting tomorrow was keyed with today.
- **A guía is never re-issued; it is corrected.** A re-issue re-dates a document to today, which for a guía could put the transport start in the past. The correction keys the same row on its new start date and checks the dates against today, so the person moves a start that has passed. `allowed.reissue` is false for a guía and the re-issue handler skips it.
- **Quota and feature.** It consumes quota like any document (FR-SAL-9) and needs `DOC_TYPE_06`. The Guías de remisión module is now `AVAILABLE` in the starting catalog.

## Consequences
- The guía's recipients cannot be searched in SQL, only the first. A recipient search would need a table, which waits for a need.
- A sale-order origin waits for Milestone 6.
- The RIDE draws a guía with its own blocks (carrier, recipients with goods, additional information) under the shared header.
