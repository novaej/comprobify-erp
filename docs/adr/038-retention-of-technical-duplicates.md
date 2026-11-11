# ADR-038: Retention of Technical Duplicates

## Status
Accepted

## Date
2026-11-11

## Context

Milestone 9 gives support a page that reads what SRI answered to each call for a document (FR-DOC-13). Every authorization check writes a row to `sri_exchanges`, with SRI's raw answer, so the table grows with the number of documents times their checks. The raw text is a technical duplicate of what the row already says (operation, outcome, messages) and of the authorized XML the document keeps.

The records the law requires, the document and its signed and authorized XML, its timeline and the summary of each exchange, are kept for the tax period. Keeping every raw answer for that long is storage with no use after support has looked.

The table is append-only by design: migration 0031 revoked `UPDATE` from the app role, and rule 12 forbids deleting application data.

## Decision

**One `RETENTION` object in core** (`kernel/retention.ts`) holds each period, read by the pruning job and written out in `docs/legal/retention.md`. Today it holds one: the raw SRI answer, 90 days.

**The raw copy is cleared, not the row.** A nightly job (`retention.prune`, 03:30 Quito) sets `sri_exchanges.raw` to null for rows older than the period, in batches. The exchange itself, with its outcome and messages, stays for the tax period, so what SRI said is never lost, only the duplicate text.

**The exception is as narrow as the database can make it.** The app role gets `UPDATE (raw)` on that one column, not on the table, so changing anything else about an exchange is a permission error. A trigger refuses any update that leaves `raw` set, so the column can be emptied and never filled or rewritten. There is still no `DELETE` grant.

**Support reads it by access key.** The platform area's "Respuestas del SRI" page finds a document by its current or a previous access key, across companies, and lists its calls with the raw answer while it exists. Opening one is written to the platform log, since it reads a company's document.

## Consequences

- The table's growth is bounded by what the summary rows need, not by the raw text.
- A document's history for the tax period is intact after the raw copies go.
- Another technical duplicate (in-app notifications at 180 days) will need its own narrow exception on the same pattern, and its own line in `RETENTION`.
- Support loses the raw text after 90 days. The summary of every call remains.

## Alternatives considered

- **Delete the rows after 90 days.** Rejected: the summary rows are the record of what SRI said, and rule 12 forbids deleting them.
- **Keep the raw text forever.** Rejected: storage with no use, and a larger copy of company data than the law asks the platform to hold.
- **Restore `UPDATE` on the whole table.** Rejected: it would let any bug rewrite history. A column grant and a clear-only trigger leave the history append-only except for the one duplicate.
