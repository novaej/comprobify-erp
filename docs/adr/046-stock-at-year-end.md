# ADR-046: Stock at year end

## Status

Accepted.

## Date

2026-11-18

## Context

Inventory has no period close, and needs none to stay correct: SRI documents can't be backdated, the stock ledger is append-only (ADR-018), and the accounting close belongs to the accountant's software. At year end the accountant still needs two things the ledger supports but the screens didn't offer. The first is the stock and its value **on a past day**, usually 31 December, while the valuation only showed the present. The second is a way to bring the books into line with a **physical count** without one adjustment per product.

## Decision

**The valuation takes a day.** `stockValuation(ctx, db, { asOf })` sums the ledger's movements per product and warehouse up to the end of that day in Ecuador (before the next midnight). The quantity, the reserved quantity and the value are those sums, and the average cost is the value over the quantity. Today, or a date that isn't valid or is in the future, reads the stock levels as before. Since the ledger is append-only, a past day's figures never change. The valuation page has an **Al día** date picker, and its CSV carries the day in its name and figures (`valoracion-inventario-2026-12-31.csv`).

**A count imports as adjustments.** **Importar un conteo** on Inventario takes a CSV of the product code, the branch (when there is more than one) and the counted quantity, plus one reason typed beside the file, such as "Conteo físico 2026". `importStockCount` checks every line first and applies nothing unless all are right, like the opening balances import.

- For each line the difference from the books becomes an `ADJUSTMENT_IN` at the current average cost (goods found) or an `ADJUSTMENT_OUT` (goods missing), with the reason and a `STOCK_COUNT` source shared by the whole file. A line that matches makes nothing.
- A count below what is reserved for invoices and orders in that warehouse is refused (`BELOW_RESERVED`). Those goods are still on the shelf, and taking them out would leave a promise the stock can't keep.
- One `stock.counted` entry goes in the OPERATIONS log (ADR-041), with the lines, how many were adjusted up and down, and the reason. Each movement also carries its author.

## Consequences

- No new tables: the as-of valuation is a grouped sum over `stock_movements`, which grows with the ledger. A company with years of movements may want a dated snapshot later. The Milestone 10 load test measures it.
- A count is applied at the moment it is imported, not dated to the counting day. A count taken on 31 December and imported on 2 January moves the stock on 2 January, with anything sold in between in the books already. Counting outside opening hours, or importing it the same day, keeps the two apart.
- `inventory.adjust` holders can import a count, the same people who adjust by hand.

## Alternatives considered

- **A period close with stored balances.** Rejected for now: nothing needs closing to stay correct, and stored balances would be a second copy of the ledger to keep in step.
- **Counts dated to a past day.** Rejected: a movement in the past would rewrite every later average cost and every later as-of figure, which the append-only ledger exists to prevent.
