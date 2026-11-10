# ADR-031: Document Packs and the Write Block

## Status
Accepted

## Date
2026-11-10

## Context

FR-BILL-7 says a company that runs out of quota buys a document pack rather than paying per document, and left pack sizes, prices and expiry as an open question (PRD section 17). The owner settled it: sizes and prices start as placeholders the super admin replaces (ADR-027), and a pack rolls over from period to period until used.

FR-BILL-5 says a past-due company is blocked from writing but can still pay. FR-BILL-9 says a company the operator suspends keeps read access to its own data. Both need one rule that every write obeys, in core (FR-ROLE-3), not a check each screen remembers.

## Decision

**A pack** is a `DOCUMENT_PACK` payment (`buyPack`). Once verified, it becomes a row in `document_packs` (migration 0053) in the real company, with its size and how much of it is used. The twin never pays or spends quota (FR-ONB-6a), so it has no packs.

- **Who can buy one.** A company with a quota and the `DOCUMENT_PACKS` feature, which the base module carries, so Gratis can buy one too. An unlimited plan has nothing to top up (`QUOTA_UNLIMITED`). A complimentary company is never charged. A past-due company pays its renewal first. The pack is priced at its own price on the day it is bought; a size with no price, or a withdrawn one, is not sold (`PACK_NOT_SOLD`).
- **How it is spent.** `consumeQuota` counts the period's documents as before. Once they reach the quota, each new document takes one from the oldest pack with any left (`consumePack`), under the same quota lock, in the document's own transaction, so a document that fails returns its unit. With nothing left in any pack, the document fails with `QUOTA_EXCEEDED`. What remains in a pack outlives the period. The plan page's `quotaUsage` reports it as `packs`.
- **Refunds.** A pack goes back with its money only while none of it is used (`PACK_IN_USE`; a database check holds it too). It is not part of the subscription, so its refund restores no snapshot, and a later payment doesn't stand in its way. Nor does a pack stand in the way of refunding an earlier plan payment.

**The write block** rides on `requirePermission`. The actor context gains `standing` (`GOOD`, `PAST_DUE`, `SUSPENDED`), which `resolveActor` reads from the tenant's own status and its subscription's status. Both are mirrored in the twin, so the twin is blocked with its company.

- **What counts as a write.** Any permission that isn't a read (`*.read`) or `reports.export`.
- **Past due.** Every write except `billing.*` fails with `ACCOUNT_PAST_DUE`. The company can still report a transfer and pay its renewal, and paying it makes the subscription active again.
- **Suspended.** Every write fails with `ACCOUNT_SUSPENDED`, billing included. Paying doesn't lift a suspension; the operator does.
- **What the block doesn't stop.** Documents already sent to SRI keep being checked and authorized, because those worker jobs act on the document, not for a member. A bulk item resolves its starter's actor, so items processed after the block fail with the block's code.

**Suspension** is the operator's (`suspendCompany`, `reactivateCompany`). It takes a reason code from FR-BILL-9 and an optional note, is written in the company and its twin alike, and is recorded in the company's activity log. A trigger refuses any change to the tenant's status, reason or date outside system context. Without it, a company's own settings write could lift its suspension, and a refused RLS update would succeed quietly (CLAUDE.md mistake 29).

## Consequences

- No screen has to remember the block. A page that hides a button only spares the user an error.
- A new permission is a write unless it ends in `.read`. Exempting one more read-only action means changing `isWrite`.
- A company can buy several packs; they are spent strictly in order, so the oldest is used up first.
- Setting `PAST_DUE` and clearing it at the end of the grace is the daily job's work (step 5); until then only the tests set it.
