import { eq, schema, type Tx } from '@comprobify/db';
import { z } from 'zod';
import type { OrderProduct } from '../catalog';
import {
  Dec,
  DomainError,
  hasFeature,
  preciseInput,
  requireFeature,
  requirePermission,
  type ActorContext,
} from '../kernel';

// What orders and receipts share, kept apart so neither imports the other.

export type PurchaseOrder = typeof schema.purchaseOrders.$inferSelect;

export function canRead(ctx: ActorContext) {
  requireFeature(ctx, 'PURCHASE_ORDERS');
  requirePermission(ctx, 'purchasing.read');
}

export function canManage(ctx: ActorContext) {
  requireFeature(ctx, 'PURCHASE_ORDERS');
  requirePermission(ctx, 'purchasing.manage');
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
export async function lockOrder(tx: Tx, id: string): Promise<PurchaseOrder> {
  const [order] = await tx.db
    .select()
    .from(schema.purchaseOrders)
    .where(eq(schema.purchaseOrders.id, id))
    .for('update');
  if (!order) throw new DomainError('NOT_FOUND', 'Purchase order not found');
  return order;
}

// A received good enters stock only when it tracks stock and the company keeps inventory
// (FR-INV-6); services and the rest are received without a movement.
export const movesStock = (ctx: ActorContext, product: OrderProduct | undefined): boolean =>
  hasFeature(ctx, 'INVENTORY') && product?.kind === 'GOOD' && product.tracksStock;
