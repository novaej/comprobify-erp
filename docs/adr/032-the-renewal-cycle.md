# ADR-032: The Renewal Cycle

## Status
Accepted

## Date
2026-11-10

## Context

FR-BILL-5 asks for a renewal reminder 7 days before the period ends, a past-due warning, and expiry after a 7-day grace into `PAST_DUE`, which blocks writes but lets the company pay (ADR-031). It doesn't say what happens to a company that never pays.

The previous system did two things at once when the grace ran out: it moved the company to the free plan and marked it past due. A company that just stopped paying was then blocked indefinitely on the free plan, worse off than one that cancelled, which also lands on the free plan but keeps working. The owner chose two stages instead, and asked that every step be emailed.

Billing systems such as Stripe, Chargebee and Paddle agree on two points the owner also took:

- **Grace is on time.** A payment made during the grace counts as on time.
- **A late payment never moves the billing day.** The paid period runs from the old end, not from the day it was paid (CLAUDE.md mistake 1). Only a new start after the account lapsed is dated from the payment.

## Decision

**A daily job**, `billing.daily`, runs at 06:00 Quito time over every paying company with a billed period. Each company gets its own transaction, so one failure doesn't hold back the others; the job then fails and pg-boss runs it again. Each step reads the subscription as it is now and does only what is still due, so a second run, or a run after missed days, is harmless (NFR-JOB-1).

| When | What | Email |
|---|---|---|
| 7 days before the period ends | The renewal payment opens, priced on the day the next period starts (ADR-029) | `renewalDue`, with the amount and the date |
| The period ends unpaid | Grace: full access for 7 days | `graceStarted`, with the day access is restricted |
| 7 days after the end | `PAST_DUE`: only reading and paying (ADR-031), twin included | `pastDue`, with the day it moves to Gratis |
| 14 days past due | Gratis: extra users and add-ons dropped, the unpaid renewal and any other unpaid change cancelled | `movedToFree` |
| A cancelled company's period end | Gratis, the same way | `movedToFree` |

The lengths are in one place, `BILLING_DAYS` (7, 7, 14).

- **Paying in time.** Paying the renewal at any point before the move to Gratis renews the period from its old end and makes the subscription active again. After the move, a company that wants a paid plan starts one, dated from its payment.
- **On Gratis.** The free period starts at the old end, so its monthly quota keeps the company's billing day. Document packs stay, and so does an unpaid pack payment: their documents are still worth having on Gratis.
- **A transfer in review holds the cycle.** While the company has a non-pack payment under the operator's review, it is not made past due or moved to Gratis: whether it paid is the operator's call, not the job's. If the transfer is rejected, the cycle continues, and the 14 days of past due count from the day the company actually became past due, kept in the activity log event's `since`.
- **Emails** go to the company's active owners and admins, the roles that pay, each in their own language, through `email.send` in the same transaction as the step. The button opens the company's plan page (`APP_URL`, now also read by the worker).
- **The record.** Each step is recorded in the company's activity log (`subscription.renewal_due`, `grace_started`, `past_due`, `moved_to_free`) with the period end it belongs to. That record is also how a step's email is sent only once.

## Consequences

- A company that stops paying ends up where a company that cancels does, three weeks later, with two weeks in which only paying unblocks it.
- No status of its own for "in grace": it is a date range, computed by the job.
- In-app notifications for the same steps come with Milestone 9's notification centre. The emails are code templates until then, like the others (FR-NOT-3).
- The operator's own warnings, such as an invoice still owed for a verified payment, are separate (step 7).
