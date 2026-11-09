import { and, eq, schema, STOCK_SOURCE_TYPES, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { stockedProduct } from '../catalog';
import { Dec, DomainError, preciseInput, requireFeature, type ActorContext } from '../kernel';
import { negativeStockRule } from '../tenancy';
import { applyCost } from './cost';

// FR-INV-1, FR-INV-2 (ADR-018, ADR-020). Movements that bring goods in carry their unit cost;
// those that take goods out leave at the average. A reservation holds goods without moving
// them, and a sale takes out what was reserved.
export const STOCK_IN = [
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'ADJUSTMENT_IN',
  'RETURN_IN',
] as const;
export const STOCK_OUT = ['ADJUSTMENT_OUT'] as const;
export const STOCK_HOLD = ['RESERVATION', 'RELEASE', 'SALE'] as const;

const positive = preciseInput.refine((value) => new Dec(value).gt(0), 'Must be more than 0');
const common = {
  productId: z.uuid(),
  warehouseId: z.uuid(),
  quantity: positive,
  source: z
    .object({ type: z.enum(STOCK_SOURCE_TYPES), id: z.uuid() })
    .nullable()
    .default(null),
  reason: z.string().trim().min(1).max(300).nullable().default(null),
};
export const movementInput = z.discriminatedUnion('type', [
  // Null comes in at the level's current average, as an adjustment of found goods does.
  z.object({ type: z.enum(STOCK_IN), unitCost: preciseInput.nullable().default(null), ...common }),
  z.object({ type: z.enum(STOCK_OUT), ...common }),
  z.object({ type: z.enum(STOCK_HOLD), ...common }),
]);
export type MovementInput = z.input<typeof movementInput>;

export type StockLevel = typeof schema.stockLevels.$inferSelect;
export type StockMovement = typeof schema.stockMovements.$inferSelect;

// Who moves stock: a person, or the worker acting on SRI's answer (null).
export type Mover = { tenantId: string; userId: string | null };

// The one way stock changes. It runs in the caller's transaction, so the movement commits or
// rolls back with the receipt, adjustment or document that caused it.
export async function applyMovement(
  ctx: ActorContext,
  tx: Tx,
  raw: MovementInput,
  // An opening balance is only the first movement of its level (FR-INV-3).
  options: { onlyFirst?: boolean } = {},
): Promise<{ movement: StockMovement; level: StockLevel }> {
  requireFeature(ctx, 'INVENTORY');
  return moveStock(tx, { tenantId: ctx.tenantId, userId: ctx.userId ?? null }, raw, options);
}

// The level row, created on first use and locked: two movements of the same product and
// warehouse wait for each other. Until stock arrives its average is the product's cost.
export async function lockLevel(
  tx: Tx,
  tenantId: string,
  productId: string,
  warehouseId: string,
): Promise<StockLevel> {
  const { stockLevels } = schema;
  const product = await stockedProduct(tx, productId);
  await tx.db
    .insert(stockLevels)
    .values({ tenantId, productId, warehouseId, averageCost: product.cost ?? '0' })
    .onConflictDoNothing();
  const [level] = await tx.db
    .select()
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, tenantId),
        eq(stockLevels.productId, productId),
        eq(stockLevels.warehouseId, warehouseId),
      ),
    )
    .for('update');
  if (!level) throw new Error('A stock level that was just ensured is missing');
  return level;
}

// Without the feature check, for the worker: a document's stock follows what it reserved
// while the company had Inventario, whatever the plan says when SRI answers (ADR-020).
export async function moveStock(
  tx: Tx,
  mover: Mover,
  raw: MovementInput,
  // anyRule: an outflow that must happen whatever the negative-stock rule (a voided return).
  options: { onlyFirst?: boolean; anyRule?: boolean } = {},
): Promise<{ movement: StockMovement; level: StockLevel }> {
  const input = movementInput.parse(raw);
  const { stockLevels, stockMovements } = schema;
  const { tenantId } = mover;
  const level = await lockLevel(tx, tenantId, input.productId, input.warehouseId);
  if (options.onlyFirst) {
    const [moved] = await tx.db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          eq(stockMovements.productId, input.productId),
          eq(stockMovements.warehouseId, input.warehouseId),
        ),
      )
      .limit(1);
    if (moved)
      throw new DomainError(
        'STOCK_ALREADY_MOVED',
        'An opening balance goes only where stock has not moved yet',
      );
  }

  const quantity = new Dec(input.quantity);
  const reserved = new Dec(level.reserved);
  // What a person takes or holds can't pass what is free, unless the company allows it.
  if ((input.type === 'ADJUSTMENT_OUT' || input.type === 'RESERVATION') && !options.anyRule) {
    const available = new Dec(level.onHand).sub(reserved);
    if (quantity.gt(available) && (await negativeStockRule(tx, tenantId)) === 'BLOCK')
      throw new DomainError('INSUFFICIENT_STOCK', 'There is not enough stock available', {
        available: available.toString(),
      });
  }
  // A release or a sale only ever undoes a reservation that exists.
  if ((input.type === 'RELEASE' || input.type === 'SALE') && quantity.gt(reserved))
    throw new Error(
      `A ${input.type} of ${quantity.toString()} exceeds the reserved ${reserved.toString()}`,
    );

  const state = {
    onHand: new Dec(level.onHand),
    value: new Dec(level.value),
    averageCost: new Dec(level.averageCost),
  };
  const held =
    input.type === 'RESERVATION' ? quantity : input.type === 'RELEASE' ? quantity.neg() : null;
  const result =
    held !== null
      ? { level: state, unitCost: state.averageCost, value: new Dec(0) }
      : applyCost(
          state,
          'unitCost' in input
            ? { direction: 'IN', quantity, unitCost: new Dec(input.unitCost ?? level.averageCost) }
            : { direction: 'OUT', quantity },
        );
  const reservedChange = held ?? (input.type === 'SALE' ? quantity.neg() : new Dec(0));

  const [updated] = await tx.db
    .update(stockLevels)
    .set({
      onHand: result.level.onHand.toFixed(6),
      reserved: reserved.add(reservedChange).toFixed(6),
      value: result.level.value.toFixed(6),
      averageCost: result.level.averageCost.toFixed(6),
    })
    .where(eq(stockLevels.id, level.id))
    .returning();
  const [movement] = await tx.db
    .insert(stockMovements)
    .values({
      tenantId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity: (held !== null
        ? new Dec(0)
        : 'unitCost' in input
          ? quantity
          : quantity.neg()
      ).toFixed(6),
      reserved: reservedChange.toFixed(6),
      unitCost: result.unitCost.toFixed(6),
      value: result.value.toFixed(6),
      sourceType: input.source?.type ?? null,
      sourceId: input.source?.id ?? null,
      reason: input.reason,
      createdBy: mover.userId,
    })
    .returning();
  return { movement: movement!, level: updated! };
}
