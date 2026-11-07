import { Dec } from '../kernel';

// FR-INV-5, ADR-018: weighted average cost per product and warehouse. Pure, so the rules are
// tested without a database. Every amount keeps six decimals, as the columns do.

export type LevelState = { onHand: Dec; value: Dec; averageCost: Dec };

export type CostChange =
  // Goods come in at a known unit cost: a receipt, an opening balance, an adjustment in.
  | { direction: 'IN'; quantity: Dec; unitCost: Dec }
  // Goods leave at the current average: an adjustment out, later a sale.
  | { direction: 'OUT'; quantity: Dec };

export type CostResult = {
  level: LevelState;
  // The movement's unit cost and its signed change to the level's value.
  unitCost: Dec;
  value: Dec;
};

const six = (value: Dec) => value.toDecimalPlaces(6);

export function applyCost(level: LevelState, change: CostChange): CostResult {
  if (!change.quantity.gt(0)) throw new Error('A stock change needs a positive quantity');
  if (change.direction === 'IN') {
    const onHand = level.onHand.add(change.quantity);
    // With stock on hand the new cost is blended in. With none, or less than none, the
    // receipt's cost is the cost: a negative balance is settled at the price it was bought at.
    const value = level.onHand.gt(0)
      ? level.value.add(six(change.quantity.mul(change.unitCost)))
      : six(onHand.mul(change.unitCost));
    const averageCost = onHand.gt(0) ? six(value.div(onHand)) : change.unitCost;
    return {
      level: { onHand, value, averageCost },
      unitCost: change.unitCost,
      value: value.sub(level.value),
    };
  }
  const onHand = level.onHand.sub(change.quantity);
  // The last units take what value is left, so an empty level is worth exactly zero.
  const out = onHand.isZero() ? level.value : six(change.quantity.mul(level.averageCost));
  return {
    level: { onHand, value: level.value.sub(out), averageCost: level.averageCost },
    unitCost: level.averageCost,
    value: out.neg(),
  };
}
