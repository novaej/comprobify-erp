# ADR-047: Keyset paging for the large lists

## Status

Accepted.

## Date

2026-11-18

## Context

NFR-PERF-4 asks for lists on large tables to page by keyset, never by `OFFSET`. Every list was paged by `OFFSET` with a total count, which costs more with every page and every row a company adds. A company with years of documents would feel it first in Comprobantes, then in a product's movements and in the notification list.

## Decision

- **One helper.** `keysetPage` (in `kernel/keyset.ts`) reads a page after or before a cursor. The cursor is the ordered values of the row it points at, base64url-encoded JSON, opaque to the screens. A cursor that isn't one of ours reads as the first page. The order always ends in the row's uuidv7 id, so no two rows tie and none is skipped or shown twice. Mixed directions work, because the condition is written as `(a > x) OR (a = x AND b > y) …`. Going back reads in the reverse order and turns the page round.
- **No page numbers.** Lists show **Anterior** and **Siguiente** (`ListPager`). They keep their filters and sort in the URL, with `after` or `before` beside them. The total count is not read: counting a large table on every page is the cost keyset paging removes.
- **Where:** Comprobantes, with each of its sort columns, then issue date, sequential and id. A product's stock movements and a member's notifications order by id alone: a uuidv7 grows with time and is exact, while a timestamp read back into JavaScript loses its microseconds and could not be a cursor. New indexes serve each path: `documents (tenant_id, issue_date, sequential, id)`, `stock_movements (tenant_id, product_id, id)`, `notification_receipts (tenant_id, user_id, id)`.

## Consequences

- The smaller lists (sale and purchase orders, bulk batches, the catalog, the platform's log and notices) still page by `OFFSET`. They stay small per company, or are the operator's. Each moves to `keysetPage` when it grows, with no change to the helper.
- Searching by buyer name with `ILIKE '%…%'` still scans the company's documents. Keyset paging bounds each page, not the search. A trigram index is the next step if the load test shows it.

## Alternatives considered

- **Keep OFFSET and cap the page number.** Rejected: it hides old pages instead of making them cheap.
- **A cursor holding only the id.** Rejected for Comprobantes: its sort columns are not in id order.
