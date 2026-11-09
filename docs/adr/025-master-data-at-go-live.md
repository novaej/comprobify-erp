# ADR-025: Copying Master Data at Go-live

## Status
Accepted

## Date
2026-11-09

## Context

FR-ONB-5 says going live offers to copy master data from the test twin to the real company: products, clients, providers and templates, never transactions. It is one-way and happens once. Questions the PRD leaves open:

- What if the real company already has some of that data?
- Which rows come, and what about a template that points at the twin's own clients and products?
- Where does it run, and what is recorded?

## Decision

**It runs inside the go-live transaction** (`goLive`'s `copyMasterData` option, `masterdata/copy.ts`), in system context with both tenants named: a go-live that fails copies nothing, and the one-way, once-only rule is go-live's own (`ALREADY_LIVE`). The module reads the master-data tables because copying them is its whole job, and it imports nothing from `tenancy`, so there is no cycle.

**Only active rows, and only what the real company lacks.** An inactive row was put away on purpose. A row that clashes with one already there (the same product code, or the same identification for a client or provider) is left alone: the real company may have started entering data before going live, and its version wins. Nothing is updated or duplicated. The result is how many of each kind were added.

**Templates are moved to the copies.** A template names a client and products of the twin. Each is replaced by the real company's row with the same identification or code, or by nothing when there isn't one (a line without a product is free text, which an invoice allows), so a template opened in the real company never points at the twin.

**The offer shows what would come.** The go-live page counts the twin's active rows (`masterDataToCopy`, for the go-live role) and offers the copy, checked by default: most companies want what they tested with. Without any, or unchecked, nothing is copied. Stock, orders and documents are never part of it.

**It is audited in the go-live event**, whose details carry the four counts, rather than as an event of its own.

## Consequences

- A company that tested with a clean set of data goes live with it, and one that didn't can skip it.
- The twin keeps everything it had: nothing flows back, and after going live a reset (a later feature) is the only way the two meet again.
- A product copied without its stock starts at zero in the real company; opening balances are entered there (FR-INV-3).
