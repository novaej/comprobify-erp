# ADR-035: Personalizado Billing and Complimentary Add-ons

## Status
Accepted

## Date
2026-11-10

## Context

Personalizado (ADR-011) is the plan the operator negotiates with a company: its modules, its limits (any of them unlimited) and a monthly price. Until now that price was stored and never charged. Nothing started a Personalizado period, and renewals priced plans from the price list, where Personalizado has no line.

Two other gaps came up while settling this with the owner:

- **Modules the operator adds to a paying company.** They were charged from the next renewal like bought ones, with no way to give one as a courtesy.
- **Renewals paid early.** A renewal verified before its period started applied at once whatever was due at the end: a lower plan, fewer users, yearly to monthly. A company that paid five days early lost five days of the plan it had paid for. The owner's rule is that the running plan is kept to the end of its period.

## Decision

**Personalizado is billed at its negotiated price.**

- **The price.** The company's monthly charge on Personalizado is the negotiated price, ten times that for a year, plus IVA. Its modules and users are the deal: no add-on or extra user is charged on top, and on Personalizado the operator sets the user limit itself.
- **Starting it.** A company on Personalizado with no paid period has its first payment created by the operator (`startCustomBilling`, on the company's platform page). It is paid by transfer or card like any other, and the period starts the day it is verified.
- **Renewals.** They follow the same cycle (ADR-032) at the negotiated price on the day the next period starts.
- **Changing the price.** A new price applies from the next renewal. An open renewal not yet reported is priced again, and the payer is emailed the new total (`renewalRepriced`). One already reported is the operator's to invoice by hand.
- **What the company changes itself.** Packs, cancelling and resuming, and paying. Plan, users and add-ons are the operator's (`CUSTOM_PLAN_MANAGED`), and the plan page says so.

**A paying company moves to Personalizado** (`moveToCustom`), keeping its monthly or yearly cycle:

- **Costing more than it pays now:** the difference for the days left is paid now, like an upgrade (ADR-030). Once paid it switches, the period stays, and extra users are dropped since Personalizado sets its own.
- **Costing the same or less:** it keeps the plan it paid for until the period ends and switches with the renewal.
  - **What the operator sets meanwhile.** Modules and limits set while the move is pending are for Personalizado: they start on that date (`subscription_items.starts_at`, migration 0058) and the resolver ignores them until then.
  - **No undoing.** The company can't undo the operator's move.

**A renewal paid before its period starts waits for it.**

- **At verification.** The payment is recorded with the next period's dates, and the subscription doesn't move.
- **On the period's first day.** The daily job applies it before anything else (`applyDueRenewal`), with what was due at the end.
- **Until then:**
  - no second renewal opens;
  - deferred changes, dropping an add-on and cancelling wait (`RENEWAL_ALREADY_PAID`), since the paid renewal was priced with what was due.
- **Paid on or after the end.** In the grace, or later, it still applies at once.

**An add-on can be complimentary**: added that way, or switched later, with a reason (`subscription_items.complimentary`). It is never charged, neither by a renewal nor when a paid plan starts, and is marked "Cortesía" on the company's page. Switching it back makes it charged from the next renewal. A company's own purchases are never complimentary. Each switch is recorded in the activity log.

## Consequences

- Every plan, Personalizado included, is paid through the same payments, review, card and cycle.
- A company keeps until its period ends whatever it paid for, however early it pays the next one.
- The operator prepares a Personalizado deal ahead, and it starts on its date.
- `subscription_items` gains a start date and a complimentary flag with its reason; both are mirrored in the twin like every subscription write.
