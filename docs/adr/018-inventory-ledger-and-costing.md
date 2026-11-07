# ADR-018: The Inventory Ledger and Weighted Average Cost

## Status
Accepted

## Date
2026-11-07

## Context

Milestone 5 adds stock. FR-INV-1 asks for an append-only ledger of movements, and FR-INV-2 for levels updated in the same transaction as each movement, under a row lock, never recomputed from the ledger on the hot path. FR-INV-4 makes negative stock a company setting that blocks by default. FR-INV-5 proposes weighted average cost, and PRD open question 6 asks whether FIFO would be better.

Questions the PRD leaves open:

- Weighted average or FIFO?
- One average per product, or one per product and warehouse? Each branch has its own warehouse (FR-MD-4).
- How is the average kept so rounding never builds up?
- What cost does an outflow have when there is no stock, and what does a receipt do to a negative balance?
- When does an invoice start moving stock? Invoices already exist (Milestone 3), but sale orders and reservations come in Milestone 6.

## Decision

**Weighted average, decided with the owner.** NIC 2 allows weighted average and FIFO, and forbids LIFO. Weighted average keeps one cost per level, needs no cost layers, and is the one SMB accountants in Ecuador expect. FIFO would make every sale, return and adjustment choose layers, and a correction would have to unpick them.

**One average per product and warehouse.** Branches that buy at different prices keep their own cost, and a future transfer leaves at the source's average. The valuation report adds the warehouses up.

**Value is the source of truth; the average follows it.** `stock_levels` keeps `on_hand`, `reserved`, `value` (the total cost of what is on hand) and `average_cost`, all `numeric(18,6)`. The cost rules are a pure function, `applyCost` (`inventory/cost.ts`):

- Goods in at a unit cost, with stock on hand: the value grows by quantity × cost, and the average is value ÷ on hand.
- Goods in onto zero or negative stock: the receipt's cost becomes the average, and the value is on hand × that cost. A negative balance is settled at the price the goods were bought at.
- Goods out leave at the current average, which doesn't change. The last units out take whatever value is left, so an empty level is worth exactly zero and no rounding residue survives it.
- With no stock ever, a level's average starts at the product's `cost`, or zero.

Each movement records its unit cost and its **signed change to the level's value**, as well as its signed quantity and reserved change. The ledger therefore always sums to the level, which is what the nightly check (FR-INV-2) compares.

**One function moves stock.** `applyMovement(ctx, tx, input)` (`inventory/ledger.ts`) runs in the caller's transaction, so a movement commits or rolls back with the receipt, adjustment or document that caused it. It:

1. needs the `INVENTORY` feature, and a product that is a good with `tracks_stock` (FR-INV-6);
2. creates the level on first use, then takes it `FOR UPDATE`, so two movements of one product and warehouse wait for each other;
3. refuses an outflow beyond the available stock (on hand minus reserved) when the company's `negative_stock` is `BLOCK` (`INSUFFICIENT_STOCK`);
4. writes the level and the movement.

Movement types are one TypeScript list (`STOCK_MOVEMENT_TYPES`) that generates the CHECK. For now `applyMovement` takes the inflows (opening balance, receipt, adjustment in, return in) and the outflows (adjustment out, sale). Reservations and releases join it with sale orders.

**The ledger is append-only.** The app role has no `UPDATE` on `stock_movements`, on top of the `DELETE` it never has. A mistake is corrected with another movement.

**What a person does by hand** (FR-INV-3, `inventory/adjustments.ts`). An adjustment says why. Goods come in at a cost, or at the current average when none is given, and leave at the average. An opening balance is only a level's first movement (`STOCK_ALREADY_MOVED` otherwise), checked under the level's lock. The CSV import checks every line before it applies any, and applies them all in one transaction: a file goes in whole or not at all, and each refused line says why. It reads the columns in Spanish or English, takes `;` with decimal commas as Excel saves in Spanish, and needs the branch only when the company has more than one warehouse. A trigger on `products` refuses to stop tracking stock that a warehouse still holds or reserves, and a service never tracks stock (FR-INV-6).

**Invoices start moving stock in Milestone 6, decided with the owner.** That milestone adds the reservation when a document is created, the sale when SRI authorizes it, the release on void, and the credit note's `RETURN_IN` at the cost the sale went out at. Doing all of it together means a return can never add stock that never left.

**The negative-stock rule lives on the company** (`tenants.negative_stock`, `BLOCK` or `ALLOW`). Like the other company settings, it is set on the company and its twin together. It is read in the moving transaction, so the rule applied is the one in force at that moment.

## Consequences

### Positive

- The level is one locked row read: no sums on the hot path, and concurrent outflows can't oversell (a test races two).
- The ledger sums exactly to the levels, in quantity and in value, so drift is a plain comparison.
- The cost rules are tested without a database.

### Negative

- Changing the costing method later means replaying the ledger. The movements keep their quantities and costs, so it is possible, but it is a migration.
- A receipt onto negative stock moves the value by more or less than quantity × cost. The movement records the real change, and the difference is the cost of having sold what wasn't there.
- Branches that share goods without transfers (post-MVP) can't move stock between their averages yet.

### Alternatives considered

- **FIFO:** rejected with the owner (above).
- **One average per company:** rejected. A branch's cost would move when another branch buys.
- **Keeping only the average, recomputing value as on hand × average:** rejected. Rounding the average at six places would drift the value with every movement, and the nightly check couldn't tell drift from rounding.
- **Levels as a view over the ledger:** rejected by FR-INV-2. Summing on every sale doesn't scale, and it can't be locked.
