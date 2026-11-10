# ADR-029: Payments and Their Review

## Status
Accepted

## Date
2026-11-10

## Context

FR-BILL-2 to FR-BILL-4 and FR-BILL-8 describe how a company pays: a payment per purpose (`INITIAL`, `RENEWAL`, `TIER_CHANGE`, `SEAT_CHANGE`, `DOCUMENT_PACK`) with its base, IVA and total and a short code; a bank transfer (SPI) reported with proof that the operator reviews, or a card through Payphone; access granted as soon as a payment is verified, with the operator's own invoice for it tracked as a work queue; and refunds that restore what the payment changed, never "down to Gratis". The previous system learnt each of these the hard way, and recorded why:

- Activation used to wait for the operator's invoice to be authorized, which made the customer absorb an SRI outage. A verified payment grants access; the invoice is the operator's obligation, on the operator's clock.
- A manual downgrade after money came back left the subscription claiming the reversed tier, and the next renewal billed it. A refund restores a snapshot taken just before the payment was applied.
- A payment settled twice extends a period twice.
- Proof files were overwritten, and the history of a rejected and resubmitted transfer was lost.

## Decision

**A payment is a row of the real company** (`payments`, migration 0051), never of the twin, which doesn't pay (FR-ONB-6a). A member working in the twin reaches it through the real company. Its amounts are the base before IVA, the IVA at the rate in force when it was created (`IVA_RATE`, 15 by default, kept on the payment), each rounded to the cent, and their sum. The code is `CB-` and eight characters without 0, O, 1, I or L, so it survives being typed into a bank transfer. What it buys is in columns (the target plan and interval, seats, a pack's size), and how the amount was reached is kept with it (`pricing`).

**Prices come from the price in force on the date the period starts** (ADR-027): a new plan from today, a renewal from the day its next period starts. A plan's charge is the plan plus each add-on module the company carries; yearly is ten months of it.

**Statuses and their machine**, generated into a trigger (rule 17): `PENDING` (owed; the PRD's `PENDING_PAYMENT`), `REPORTED` (the company says it paid), `VERIFIED`, `REJECTED` (with a reason code: amount mismatch, transfer not found, wrong account, illegible proof, duplicate, other), `CANCELLED` and `REFUNDED`. A rejected payment can be reported again or cancelled; a pending one can be verified directly, for a card charge (step 6). A company has at most one open payment of its own making at a time, and can't cancel a renewal: the period it pays for is owed either way.

**Proof is added, never replaced** (`payment_proofs`). Each submission carries 1 to 5 files, PNG, JPEG, GIF or PDF by their first bytes, at most 2 MB each, with the bank's reference; at most 10 are active on a payment. A company can take a file out of its own view; the operator still sees every file. The app role can't change a file's content.

**One place turns a verified payment into access** (`applyVerifiedPayment`), in the transaction that verifies it. It records the subscription as it was (`applied_from`) and then moves it: a first payment starts the paid period on the day it is paid (the one period that starts on "now"); a renewal starts at the old end, so paying early or late never moves the billing day. The company and its twin are changed alike. The period paid for is stamped on the payment, since the subscription's own dates move on. Plan changes, seats and packs are applied the same way from step 4.

**The operator reviews in the platform area**, with one decision: verify or reject. A settled payment is never reviewed again. Every change is in the company's activity log (`payment.created`, `payment.reported`, `payment.cancelled`, `payment.verified`, `payment.rejected`, `payment.refunded`).

**A refund restores the snapshot.** Only a verified payment with a snapshot is refunded, latest first: refunding one that a later verified payment built on would erase that one too, so it is refused until the later one is refunded. Whether the company is also suspended is a separate decision (FR-BILL-9).

**Notifications wait for Milestone 9.** The company learning its payment was verified or rejected, and the operator learning a proof arrived, are logged in the activity log now and become notifications and emails with the notifications module.

## Consequences

- A paying company has its plan the moment the operator verifies, whatever SRI is doing.
- Every charge can be explained afterwards: its rate, its lines and the period it paid for are on it.
- Reversals are handled by a function rather than by hand; detecting them stays manual, as neither SPI nor a card rail tells us.
- The operator still has to issue the invoice. The platform's Por facturar screen lists every verified payment until the invoice for it is recorded. The operator issues it from its own company in Comprobify and records it by access key. It must be an authorized factura for the company's RUC and for the payment's total, and used for one payment only, so a mistyped key can't close the wrong payment (`markPaymentInvoiced`). A refunded payment leaves the queue.
