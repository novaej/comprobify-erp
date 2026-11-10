# ADR-033: Card Payments Through Payphone

## Status
Accepted

## Date
2026-11-10

## Context

FR-BILL-3 adds card payments through Payphone beside bank transfers, and asks for the previous system's behaviour exactly: every guard in it came from a real incident. The facts that shape it:

- **The confirm call captures the money**, and Payphone reverses any charge not confirmed within 5 minutes. The return page Payphone redirects to must confirm as soon as it loads, and every way of missing those 5 minutes needs a path back.
- **The widget (Cajita de Pagos)** runs in the payer's browser. It takes the token and store id as its configuration, so the token isn't secret from a company. It only renders on the domain registered in Payphone's console.
- **Payphone's answers** echo the payer's email, phone and identification. It refuses charges under $1.00 (its error 107), and "transaction not found" comes back as a 404 with a body, which is an answer, not a broken host.
- **Card display data has no length promise.** A card brand longer than the column once crashed a successful confirmation, so those fields are text.

This is how a company pays Comprobify, never a way for it to charge its own customers. The amount always comes from one of the company's own payments, never from the request.

## Decision

**One attempt per widget opening** (`payphone_transactions`, migration 0055, in the real company under RLS), never reused. A pending attempt with no Payphone id can't be told apart between "the payer closed the widget" and "the payer paid and the redirect was lost", so reusing its id could submit a live transaction twice. Each attempt gets a new 16-character id; at most 10 may be pending per payment. The statuses are `PENDING` (unknown) and the final `APPROVED`, `CANCELLED`, `EXPIRED`, `DUPLICATE` and `ERROR`, with a transition trigger generated from the code (rule 17). `APPROVED` may still become `DUPLICATE` when applied.

**Starting** (`startCardPayment`) gives the widget its configuration:

- **Amounts in cents.** The taxed part is derived from the total and the IVA, so the parts always add up.
- **A reference** naming the payment, plus the machine outside production, to tell environments apart in Payphone's console.
- **What it refuses:** a payment that is settled, under $1.00, or has a transfer under review (a card charge then could pay it twice).

**Confirming** (`confirmCardPayment`, from the return page) happens in two phases:

1. **Ask Payphone, and commit its answer.** The attempt's lock is held across the call (10-second limit), so a second load of the page waits and then reads the stored answer without asking again.
   - **A transport failure is not a decline.** The attempt stays `PENDING`, with Payphone's id saved so the sweep can ask again.
   - **If anything fails after Payphone answered,** its id is still saved on its own.
   - **Never trust the echoed amount.** A different amount is `ERROR` and is never applied.
   - **What is kept:** only an allow-list of Payphone's fields, without the payer's personal data.
2. **Apply.** The payment is verified (`method = PAYPHONE_CARD`, no reviewer) and goes through `applyVerifiedPayment`, in one transaction with the attempt's `applied_at`.
   - **A duplicate.** If the payment was settled first by another attempt or a transfer, or was cancelled meanwhile, the charge is `DUPLICATE`: never applied, written to the company's activity log (`payment.card_duplicate`) and logged as an error, for the operator to refund by hand in Payphone's dashboard.
   - **Why this is stronger than the previous system.** There, a duplicate reached through its sweep was only stamped as applied. Here, verifying and stamping share one transaction, so a payment that is already verified while this attempt is unstamped can only mean another charge paid it.

**The sweep** (`payphone.reconcile`, every 5 minutes) runs two passes:

- **Attempts pending more than 10 minutes.** With no Payphone id, the return page never reached us and Payphone has reversed the charge, so the attempt expires without a call. With an id, it asks again: approved is applied, anything else has been reversed.
- **Approved charges with no `applied_at`,** the gap between the phases, are applied.

**Configuration.** `PAYPHONE_TOKEN` and `PAYPHONE_STORE_ID` are both set or both unset. Unset, card payments are refused (`CARD_NOT_AVAILABLE`), transfers carry on, and the sweep does nothing. That is also the switch for a restored copy of real data: no token, no charges. Payphone has no callbacks to silence. The token is never logged.

**Refunds stay manual for both methods**, as ADR-029 settled. `refundPayment` moves no money. Payphone's reversal API covers only the same day until 20:00, so automating card refunds alone would give the operator two procedures for one decision.

## Consequences

- A company pays by card and is active in seconds; renewals stop needing a proof each month.
- The gap between capturing and applying is real, but bounded by the sweep's 5 minutes.
- Missed confirms depend on the worker running the sweep.
- Duplicates need the operator. The platform's reconciliation view (step 7) lists the `DUPLICATE` and `ERROR` attempts; until then, the activity log and the error log carry them.
- Payphone's own push notification, once Payphone authorises it, could replace the first pass of the sweep.
