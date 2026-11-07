import { and, eq, schema, STOCK_SOURCE_TYPES, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { stockedProduct } from '../catalog';
import { Dec, DomainError, preciseInput, requireFeature, type ActorContext } from '../kernel';
import { negativeStockRule } from '../tenancy';
import { applyCost } from './cost';

// FR-INV-1, FR-INV-2 (ADR-018). Movements that bring goods in carry their unit cost; those
// that take goods out leave at the average. Reservations arrive with sales (Milestone 6).
export const STOCK_IN = [
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'ADJUSTMENT_IN',
  'RETURN_IN',
] as const;
export const STOCK_OUT = ['ADJUSTMENT_OUT', 'SALE'] as const;

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
]);
export type MovementInput = z.input<typeof movementInput>;

export type StockLevel = typeof schema.stockLevels.$inferSelect;
export type StockMovement = typeof schema.stockMovements.$inferSelect;

// The one way stock changes. It runs in the caller's transaction, so the movement commits or
// rolls back with the receipt, adjustment or document that caused it. The level row is locked
// first: two movements of the same product and warehouse wait for each other.
export async function applyMovement(
  ctx: ActorContext,
  tx: Tx,
  raw: MovementInput,
  // An opening balance is only the first movement of its level (FR-INV-3).
  options: { onlyFirst?: boolean } = {},
): Promise<{ movement: StockMovement; level: StockLevel }> {
  requireFeature(ctx, 'INVENTORY');
  const input = movementInput.parse(raw);
  const product = await stockedProduct(tx, input.productId);
  const { stockLevels, stockMovements } = schema;
  const key = and(
    eq(stockLevels.tenantId, ctx.tenantId),
    eq(stockLevels.productId, input.productId),
    eq(stockLevels.warehouseId, input.warehouseId),
  );

  // A level is created on first use; until stock arrives its average is the product's cost.
  await tx.db
    .insert(stockLevels)
    .values({
      tenantId: ctx.tenantId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      averageCost: product.cost ?? '0',
    })
    .onConflictDoNothing();
  const [level] = await tx.db.select().from(stockLevels).where(key).for('update');
  if (!level) throw new Error('A stock level that was just ensured is missing');
  if (options.onlyFirst) {
    const [moved] = await tx.db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, ctx.tenantId),
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
  if (input.type === 'ADJUSTMENT_OUT' || input.type === 'SALE') {
    const available = new Dec(level.onHand).sub(level.reserved);
    if (quantity.gt(available) && (await negativeStockRule(tx, ctx.tenantId)) === 'BLOCK')
      throw new DomainError('INSUFFICIENT_STOCK', 'There is not enough stock available', {
        available: available.toString(),
      });
  }
  const result = applyCost(
    {
      onHand: new Dec(level.onHand),
      value: new Dec(level.value),
      averageCost: new Dec(level.averageCost),
    },
    'unitCost' in input
      ? { direction: 'IN', quantity, unitCost: new Dec(input.unitCost ?? level.averageCost) }
      : { direction: 'OUT', quantity },
  );

  const [updated] = await tx.db
    .update(stockLevels)
    .set({
      onHand: result.level.onHand.toFixed(6),
      value: result.level.value.toFixed(6),
      averageCost: result.level.averageCost.toFixed(6),
    })
    .where(key)
    .returning();
  const [movement] = await tx.db
    .insert(stockMovements)
    .values({
      tenantId: ctx.tenantId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity: ('unitCost' in input ? quantity : quantity.neg()).toFixed(6),
      unitCost: result.unitCost.toFixed(6),
      value: result.value.toFixed(6),
      sourceType: input.source?.type ?? null,
      sourceId: input.source?.id ?? null,
      reason: input.reason,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  return { movement: movement!, level: updated! };
}
