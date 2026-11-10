# ADR-027: Prices and Their History

## Status
Accepted

## Date
2026-11-09

## Context

Billing (Milestone 8) needs a price for everything a company can buy: its plan, the add-on modules on top of it (ADR-011), extra users and document packs. FR-BILL-6 asks for a price history in which a draft is published with at least 30 days' notice, and every charge resolves the price as of the date its period starts. The previous system kept one table per kind of price (tier and seat) and gave every change 30 days' notice. Questions this repository has to answer:

- One table or one per kind, and what about yearly prices?
- Does every change need notice, including a first price, a cut, or the real prices replacing placeholders before launch?
- How are the starting prices set, and how are the real ones set later?

## Decision

**One `prices` table for the four kinds** (`PLAN`, `MODULE`, `SEAT`, `PACK`; migration 0049), each row naming its plan, module or pack size, as `subscription_items` does. Amounts are before IVA. A plan, a module and a seat cost a monthly amount; yearly is always ten times it (FR-BILL-1, `YEARLY_MONTHS`), so it is computed, never stored. A pack costs its amount once, and a pack size is withdrawn by publishing a price with no amount.

**Only self-service plans and add-on modules have a list price.** Personalizado's price is negotiated per company (`subscriptions.negotiated_monthly_price`), and the base module is part of every plan; asking to price either is refused (`PLAN_NOT_PRICED`).

**A price is drafted, then published, then never changed.** A row is `DRAFT`, `PUBLISHED` or `DISCARDED`; the transitions and their trigger come from one definition (`PRICE_TRANSITIONS`, rule 17), and a second trigger refuses any change to a published or discarded row. Publishing stamps the Ecuador date it applies from. The price in force on a date is the latest published one dated on or before it (`priceOn`), and every later billing step asks with the date the period starts, so a change never reaches a period that began before it (Appendix B lesson 3). It is platform data: no tenant, written in system context only (`app_protect_platform_table`), recorded in the platform log (`price.drafted`, `price.published`, `price.discarded`).

**Notice protects what companies pay now, so it applies to a rise only.** A draft above the price in force today, on something a paying company holds, takes effect 30 days on at the earliest (`NOTICE_DAYS`, shared with the catalog's own notice rules). Everything else takes effect today: a cut, a first price, a pack (bought once, at the price shown), or a thing no paying company holds. The comparison is with today's price, not with an announced one: a draft below an announced rise but above today's price is still a rise. The super admin may pick a later date, never an earlier one (`PRICE_NOTICE_TOO_SHORT`), and two prices for one thing never start on the same day (`PRICE_DATE_TAKEN`). Who holds a thing: a paid subscription on the plan, an active add-on item for the module, and, for the seat until extra seats exist (step 4 of this milestone), every paid subscription.

**Placeholders seed, the super admin sets the real prices.** The migrate step inserts a published placeholder dated 2026-01-01 for every self-service plan, add-on and the seat that has no price at all, and three pack sizes the first time (`STARTING_PRICES`, `syncPrices`). It never touches a thing that has a price. The real prices are set on the platform's Precios page: before any company pays, they apply the same day, by the rule above. The notification that announces a rise to the companies arrives with notifications (Milestone 9).

## Consequences

- Billing asks one function for any price on any date, and history is never rewritten.
- Replacing the placeholders before launch needs no code and no waiting; after launch, a rise waits its 30 days on its own.
- A company sees the price in force when its period starts, so an announced rise reaches each company at its next renewal on or after the date.
- Yearly prices can't be set apart from monthly ones: a different discount would be a change to `YEARLY_MONTHS` and this ADR.
