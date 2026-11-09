import { eq, schema, type Tx } from '@comprobify/db';
import { z } from 'zod';
import {
  Dec,
  DomainError,
  preciseInput,
  requireFeature,
  requirePermission,
  type ActorContext,
} from '../kernel';

export type SaleOrder = typeof schema.saleOrders.$inferSelect;

export function canRead(ctx: ActorContext) {
  requireFeature(ctx, 'SALE_ORDERS');
  requirePermission(ctx, 'sales.read');
}

export function canManage(ctx: ActorContext) {
  requireFeature(ctx, 'SALE_ORDERS');
  requirePermission(ctx, 'sales.manage');
}

export const positive = preciseInput.refine((value) => new Dec(value).gt(0), 'Must be more than 0');
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => value || null);

// The order under a row lock, so two changes to it wait for each other.
export async function lockOrder(tx: Tx, id: string): Promise<SaleOrder> {
  const [order] = await tx.db
    .select()
    .from(schema.saleOrders)
    .where(eq(schema.saleOrders.id, id))
    .for('update');
  if (!order) throw new DomainError('NOT_FOUND', 'Sale order not found');
  return order;
}

export async function readOrder(tx: Tx, id: string): Promise<SaleOrder> {
  const [order] = await tx.db.select().from(schema.saleOrders).where(eq(schema.saleOrders.id, id));
  if (!order) throw new DomainError('NOT_FOUND', 'Sale order not found');
  return order;
}
