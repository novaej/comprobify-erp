# ADR-028: Subscription Periods and the Quota

## Status
Accepted

## Date
2026-11-10

## Context

Until Milestone 8 a company's "period" was the Ecuador calendar month: the document quota counted the month, and a module or limit removed with a date reached a company at the next month (ADR-011). FR-BILL-1 asks for a subscription with an interval (monthly, or yearly at ten times the price) and period dates, with the statuses `PENDING_PAYMENT`, `ACTIVE`, `CANCELLED` and `EXPIRED`; FR-BILL-5 adds `PAST_DUE` after the grace period; FR-BILL-7 counts the quota per period aligned with the subscription's, with yearly plans pooling twelve months up front.

The previous system's lessons apply directly: a billing period is always computed from the previous period's end, never from "now", with month-end clamping (Appendix B lesson 1); a yearly payer gets the year's documents up front; and the quota's period must move with the subscription's, never on a clock of its own (a separate quota table drifted from the subscription and refreshed an unpaid company's quota). What differs here: since ADR-011 a company has exactly one subscription, mirrored in its twin, which the resolver and every platform editor read. The previous system kept a new subscription row for every start and its statuses described rows, not a company.

## Decision

**The one subscription carries its interval, status and period** (migration 0050): `interval` (`MONTHLY`, `YEARLY`), `status`, and Ecuador dates `period_start` and `period_end`. A billed period runs from start to end. No end means the company isn't billed (a free plan, or complimentary) and its quota renews every month from the start day. Existing companies start unbilled from the day they were created. Periods are computed from the previous end (`periodEndFrom`, clamped at month end), never from now.

**Statuses describe the company, not a row:** `ACTIVE`, `CANCELLED` (the company asked to stop, and keeps what it paid for until the period ends) and `PAST_DUE` (the period ended unpaid past the grace: writes are refused, paying brings it back). The PRD's other two are kept as what they mean, in the place they belong with one subscription: a payment still owed is the payment's own state (`PENDING_PAYMENT`, step 3), and an expired, unpaid period is `PAST_DUE`. The transitions and their trigger come from one definition (`SUBSCRIPTION_TRANSITIONS`, rule 17). This step adds the columns and rules; payments, cancellation and the daily job (steps 3 to 5) move a subscription through them.

**The quota counts the documents made in the quota window, so there is nothing to keep in step** (`quotaWindow`). A billed period is the window, whole, holding the plan's monthly quota times its months: one for monthly, twelve for yearly. An unbilled company's window is the month from its anchor day, each one counted from the anchor so the 31st stays the 31st. After a billed period ends and before it is renewed, it stays the window: the quota never refreshes for a period nobody paid. Documents are counted, not tallied in a counter, so the count can't drift and a rolled-back document gives its quota back. The twin and a company still in test use no quota, as before. Document packs top it up (step 4).

**Everything that said "the next month" now says "the next period".** The resolver keeps a dated removal until the company's own period start after it, and the super admin's removal of an add-on is dated at the end of the company's current window. The plan page shows the period, its interval and the quota used in the window.

## Consequences

- A yearly company can spend its year's documents in any month, and a renewal paid late never moves its billing day.
- Removals and lower limits reach each company on its own renewal day, not on the first of the month: two companies on the same plan can see a removal on different days, each at its renewal.
- Counting documents in the window costs one indexed count per document issued, which the quota lock already serializes per company.
- `PENDING_PAYMENT` and `EXPIRED` don't appear on the subscription; anything reporting on them reads the payment and `PAST_DUE`.
