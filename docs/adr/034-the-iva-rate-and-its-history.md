# ADR-034: The IVA Rate and Its History

## Status
Accepted

## Date
2026-11-10

## Context

FR-BILL-2 put the IVA charged on subscriptions in a setting, `IVA_RATE` (ADR-029). A setting keeps one value: changing it loses the old rate, needs a deploy, and takes effect the moment the process restarts, not on the day the law sets. Ecuador has changed its general rate before (12 % to 15 % on 1 April 2024), and may again.

Each payment already stores the rate it was created with, so a settled payment never changes. The problem is a payment still open on the day a new rate starts. The operator's factura for it must carry the rate in force on the day it is issued, so a renewal opened at the old rate and paid after the change would have the wrong IVA. Por facturar would then refuse the invoice, since the totals differ (ADR-029).

This is only the IVA on Comprobify's own subscriptions. The rates a company puts on its products are SRI's rate codes, a separate catalogue (ADR-012).

## Decision

**The rate is a table**, `iva_rates` (migration 0057): a rate and the Ecuador date it starts from, seeded with 15 % from 2024-04-01, and `IVA_RATE` is gone.

- **Protected like the other platform tables.** Only system context writes it.
- **Frozen once recorded.** A trigger refuses any change to a rate or its date, so the table is history.
- **Withdrawing.** A rate recorded by mistake may be withdrawn, only before its day comes.

**The rate on a day** (`ivaRateOn`) is the latest one that started on or before it, as `priceOn` works for prices. A payment takes the rate of the day it is created.

**The operator records a new rate** on the platform's Precios page (`scheduleIvaRate`).

- **Dates.** It starts today at the earliest, one rate per day.
- **No notice.** Unlike a price rise there are no 30 days: the law sets the date.
- **The record.** Each one is written to the platform's log.

**On the day a new rate starts**, the daily billing job (ADR-032) re-prices, before anything else:

- **Which payments.** Every payment still to pay (`PENDING`) or rejected (`REJECTED`) at another rate gets the new rate. The base stays and the IVA and total are worked out again.
- **The notice.** Each change is recorded in the company's activity log (`payment.repriced`, with the old and new totals), and its owners and admins get an email (`paymentRepriced`) with the new rate and total.
- **What keeps its rate.**
  - A transfer already reported keeps it: that money is on its way.
  - So does a payment with a card attempt still open: Payphone holds the old amount. It is re-priced the next day, once the attempt has settled.
  - For the rare reported payment that crosses a change, the operator invoices by hand.
- **Renewals opened that day.** Because the re-pricing runs first, they are already at the new rate.

## Consequences

- A rate change is a row with a date, entered ahead of time, with nothing to deploy or restart.
- The history of rates stays, and every payment says which one it charged.
- The billing functions no longer take the IVA from their callers. They read it for their day, so the web and worker have one less setting.
- A payer whose open payment changes is told before paying the wrong amount.
