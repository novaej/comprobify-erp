# ADR-030: Plan Changes, Seats and Add-ons

## Status
Accepted

## Date
2026-11-10

## Context

FR-BILL-5 asks for upgrades that are prorated and immediate, downgrades and interval changes deferred to the period end at full price, and never a negative amount, since there is no way to refund a company. FR-PLAN-1a adds extra seats, and add-on modules on a self-service plan. The previous system's rules came from experience: proration compares like with like (a monthly difference over a monthly period); a deferred change must be priced at the price on the day it takes effect; a scheduled decrease has to be seen by whatever prices the next period; and moving from monthly to yearly was made immediate (its ADR-033), crediting the unused month, because a company asking for the yearly discount shouldn't wait out its month.

Questions settled with the owner before building:

1. Monthly to yearly: immediate with a credit (chosen), or at the period end.
2. Deferred changes: paid by the renewal (chosen), or by a separate payment up front, as the previous system did for an interval change.
3. Whether a company buys add-ons itself: yes, prorated like a seat, removed at the period end.

## Decision

**What a company pays a month** is its plan, each add-on it carries that the plan doesn't already include, and its extra seats, at the prices in force on the day the period starts (`monthlyCharge`). An add-on that a plan change brings into the plan stops being charged. Yearly is ten months.

**Now, prorated, once paid** (`requestPlanChange`, `requestSeats`, `buyAddOn`):

- A plan on the same interval whose monthly charge is higher: the difference times the period's months times the share of the period left, by Ecuador days. Paid, the plan changes and the period stays.
- More seats, or an add-on: its monthly price, likewise prorated.
- Monthly to yearly, when the year costs more a month than the month does: the yearly charge less the month's charge times the share left. Paid, a yearly period starts that day, and the month's unpaid renewal is dropped.
- A change that rounds to nothing is applied at once, with no payment.

**At the period end, charged by the renewal** (`pending_plan_id`, `pending_interval`, `pending_seats` on the subscription, migration 0052): a plan whose monthly charge is lower or equal, yearly to monthly (and monthly to yearly when it isn't worth more), fewer seats, and removing an add-on (dated at the period end, as the operator's removal is). The renewal is priced with them on the day the next period starts, and applying it applies them. Scheduling one replaces an unpaid open renewal with one priced again; while the company's reported renewal is being reviewed, changes wait (`RENEWAL_IN_REVIEW`). A company can drop what it scheduled until then.

**Going to a free plan is cancelling** (`USE_CANCEL`). Cancelling sets `CANCELLED`: the company keeps what it paid for until the period ends, nothing renews (an unpaid renewal is dropped), and it can resume until then. At the end it returns to Gratis (the daily job, step 5).

**Guards.** Changes are for a company with a billed period that is active: not complimentary, not unbilled (start a paid plan first), not cancelled, not past due. One payment of the company's own making is open at a time. A refunded add-on is taken away at once, with its money; other refunds restore the snapshot (ADR-029), seats and pending changes included.

**Where it runs.** The subscription is mirrored in the twin, so the company's own changes run in system context with a reason, as membership changes do, and every query in them names the company.

## Consequences

- A company upgrades and pays only for what is left of its period; it never gets money back for a downgrade, which waits until what it paid for runs out.
- Every period is paid by one payment that says what it covered, including what changed at its start.
- Proration by days makes a February month worth the same as a March one, each against its own length.
- `ADD_ON` is a payment purpose beside the PRD's five.
