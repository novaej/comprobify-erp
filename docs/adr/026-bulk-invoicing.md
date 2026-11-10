# ADR-026: Bulk Invoicing

## Status
Accepted

## Date
2026-11-09

## Context

FR-BULK-1 to FR-BULK-4 ask for batches of invoices made by the worker, one by one, from confirmed sale orders or a CSV, with a quota that cuts the batch item by item, a stack view, and pacing so that a large batch never delays another company's single invoice (NFR-PERF-3). The worker issues these invoices, so it needs the settings issuing needs (`OPERATOR_RUC`, `CONSUMER_FINAL_MAX_AMOUNT`) that only the web had. Questions the PRD leaves open:

- What does an item's status mean once the invoice exists and SRI answers on its own schedule?
- How is the work fed to the worker so that companies take turns?
- What does "retry" mean for an item SRI rejected?
- Where does the completion notification go before notifications exist?

## Decision

**Two tables, no counters** (`bulk_batches`, `bulk_batch_items`, migration 0047). A batch holds its source (`SALE_ORDERS` or `CSV`), the issue point and, for orders, how they are paid (one payment for the whole total, as in ADR-022). An item holds its position, an order or a validated CSV row (exactly one), the document it made, the number of attempts and its failure. Progress is counted from the items, so nothing can drift. Nothing is deleted (rule 12).

**The batch's status machine is only its own work.** An item is `QUEUED`, `CREATING`, `CREATED` or `FAILED`, with `FAILED → QUEUED` for a retry; the batch is `PROCESSING` or `COMPLETED`, and a retry reopens a completed one. Both machines and their triggers come from one definition (`BATCH_ITEM_TRANSITIONS`, `BATCH_TRANSITIONS`, rule 17). The `SENT` and `AUTHORIZED` of FR-BULK-2 are not stored: once an item is `CREATED`, the stack view shows its document's status, so SRI's answers have one source and no hook from the documents module back into batches. A batch is complete when every item is `FAILED` or its invoice has a final answer; a scheduled sweep marks that, so documents never need to know batches exist.

**One item, one job, one transaction.** The worker claims an item (`QUEUED → CREATING`), then makes the invoice through the same pipeline a single invoice uses (`invoiceSaleOrder`, or `createInvoice` for a CSV row), with the item's id as the idempotency key, and sets `CREATED` and the document in that same transaction. A crash leaves `CREATING` with no document; the retried job finds it and goes on, and the key stops a second invoice. `QUOTA_EXCEEDED` (and any other `DomainError`) from the pipeline fails that item with its code and reason, and the batch carries on (FR-BULK-1).

**Fair queuing is done by feeding, not by priority** (`bulk/feed.ts`, migration 0048). A batch's items are not all put on the queue: the `bulk.feed` job hands them to `bulk.item` a few at a time and stamps each with `dispatched_at`, so an item is queued once. Each round gives one item at a time to each company with work waiting, the company with the least in flight first, until the global room or a company's own room (`perCompany`, `global`) or its waiting items run out. A company's items go in batch order. In flight means dispatched and not yet made, or made and not yet at a final answer from SRI (`FINAL_DOCUMENT_STATUSES`), so the batch documents waiting in `sri.send` and `sri.authorize` are bounded, and another company's single invoice, which is queued directly, waits behind a few documents, never thousands. The feeder reads across companies in system context with a reason (rule 7), under an advisory lock so two workers never feed at once, and queues itself again 5 seconds later while items wait. Its queue has the `short` policy (one queued job at most), so a new batch, a retry, the minutely schedule and its own re-queue never pile up into several feeders. An item that has been dispatched for 15 minutes without finishing lost its job (a crash, a purge): the feeder queues it again without taking more room, and the item job survives the repeat by reading the item's status. The caps (50 per company, 150 overall) are named constants, tuned at the Milestone 10 load test. A document that SRI can't be reached for stays in flight until it has a final answer, so an outage stops a batch feeding, as it should.

**A retry is for what the batch failed to make.** It puts `FAILED` items back in the queue (quota left, a product now active, a client fixed). An invoice SRI rejected is not retried: it is corrected and resent as the same row and number (FR-DOC-7), from its link in the stack view, as for any invoice.

**The completion notification is logged until Milestone 9.** `BATCH_COMPLETED` is logged, as the overdue-authorization alert is (FR-DOC-5); the in-app notification is added with the notifications module, together with the alerts already waiting for it.

**Who and what.** Starting a batch needs `documents.issue`, `sales.manage` (for orders) and the `BULK_INVOICING` feature; reading batches needs `documents.read`. The platform area has a read-only queue page, built from the same tables, to watch the caps work.

## Gate result

`pnpm test:bulk-gate` (on a freshly reset test database, 2026-11-09) runs the real queues and handlers over a mock SRI that answers in 50 ms. A company's 1,000-order batch with its quota at 800 ended with 800 invoices authorized and 200 items failed with `QUOTA_EXCEEDED`, the batch completed, in 670 seconds (1.19 invoices a second). Another company issuing 20 single invoices, one a second, took 17.7 s at the median and 19.9 s at p95 alone, and 17.6 s and 20.0 s beside the batch: a p95 ratio of 1.00 against the 2× NFR-PERF-3 allows. The 17 seconds are the first authorization check, 15 seconds after reception (`QUICK_CHECK_DELAYS`), not the queues.

The throughput is the room divided by how long an invoice stays in flight: with 50 in flight and about 18 seconds to a final answer, plus up to 5 seconds before the feeder notices a freed slot, a lone company's batch moves at about 1 invoice a second at these defaults. At that rate 10,000 invoices take about 2.5 hours. The caps are the knob; the Milestone 10 load test sets them against what SRI accepts.

## Consequences

- A 10,000-invoice batch costs the same per item as a single invoice and never queues thousands of documents ahead of anyone.
- Quota is checked per item, so a batch that crosses the limit stops making invoices at the exact item and fails the rest with `QUOTA_EXCEEDED`, which a retry can resume after a pack or a new period.
- Because the item's SRI status is read from the document, the stack view joins items to documents; the lists are paged.
- The caps and the feeder's period are tuning knobs: too low and a batch is slow, too high and fairness is lost.
