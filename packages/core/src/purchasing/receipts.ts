import { and, asc, eq, inArray, schema, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { productsForOrder } from '../catalog';
import { applyMovement } from '../inventory';
import { Dec, DomainError, ecuadorDate, type ActorContext } from '../kernel';
import {
  canManage,
  lockOrder,
  movesStock,
  optionalText,
  positive,
  type PurchaseOrder,
} from './shared';
import { assertPurchaseOrderTransition } from './status';

// FR-PUR-2 (ADR-019): goods arrive against an order, all at once or in parts, never more
// than is left. A good that tracks stock enters the order's warehouse at the order's cost in
// the same transaction; services, and goods that don't track stock, are received only.

export const receiptInput = z.object({
  orderId: z.uuid(),
  lines: z
    .array(z.object({ lineId: z.uuid(), quantity: positive }))
    .min(1)
    .max(200)
    .refine((lines) => new Set(lines.map((line) => line.lineId)).size === lines.length, {
      message: 'Each order line once',
    }),
  notes: optionalText(300),
});
export type ReceiptInput = z.input<typeof receiptInput>;

export type ReceiptView = {
  id: string;
  receivedDate: string;
  notes: string | null;
  createdAt: Date;
  lines: { orderLineId: string; quantity: string; moved: boolean }[];
};

export async function receivePurchaseOrder(
  ctx: ActorContext,
  db: Database,
  raw: ReceiptInput,
): Promise<{ receiptId: string; order: PurchaseOrder }> {
  canManage(ctx);
  const input = receiptInput.parse(raw);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (order.status !== 'SENT' && order.status !== 'PARTIALLY_RECEIVED')
      throw new DomainError('ORDER_NOT_RECEIVABLE', 'Only a sent order receives goods', {
        status: order.status,
      });
    const { purchaseOrderLines } = schema;
    const lines = await tx.db
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.orderId, order.id),
          eq(purchaseOrderLines.revision, order.revision),
        ),
      );
    const byId = new Map(lines.map((line) => [line.id, line]));
    for (const wanted of input.lines) {
      const line = byId.get(wanted.lineId);
      if (!line) throw new DomainError('NOT_FOUND', 'Order line not found');
      const left = new Dec(line.quantity).sub(line.receivedQuantity);
      if (new Dec(wanted.quantity).gt(left))
        throw new DomainError('RECEIPT_EXCEEDS_ORDER', 'More than is left to receive', {
          line: line.position,
          left: left.toString(),
        });
    }
    const products = new Map(
      (await productsForOrder(tx, [...new Set(lines.map((line) => line.productId))])).map(
        (product) => [product.id, product],
      ),
    );
    const [receipt] = await tx.db
      .insert(schema.purchaseReceipts)
      .values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        receivedDate: ecuadorDate(ctx.clock.now()),
        notes: input.notes,
        createdBy: ctx.userId ?? null,
      })
      .returning({ id: schema.purchaseReceipts.id });

    for (const wanted of input.lines) {
      const line = byId.get(wanted.lineId)!;
      const moved = movesStock(ctx, products.get(line.productId))
        ? await applyMovement(ctx, tx, {
            type: 'PURCHASE_RECEIPT',
            productId: line.productId,
            warehouseId: order.warehouseId,
            quantity: wanted.quantity,
            unitCost: line.unitCost,
            source: { type: 'PURCHASE_RECEIPT', id: receipt!.id },
          })
        : null;
      const received = new Dec(line.receivedQuantity).add(wanted.quantity).toFixed(6);
      await tx.db
        .update(purchaseOrderLines)
        .set({ receivedQuantity: received })
        .where(eq(purchaseOrderLines.id, line.id));
      line.receivedQuantity = received;
      await tx.db.insert(schema.purchaseReceiptLines).values({
        tenantId: ctx.tenantId,
        receiptId: receipt!.id,
        orderLineId: line.id,
        productId: line.productId,
        quantity: wanted.quantity,
        unitCost: line.unitCost,
        movementId: moved?.movement.id ?? null,
      });
    }

    const complete = lines.every((line) => new Dec(line.receivedQuantity).gte(line.quantity));
    const status = complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    let current = order;
    if (status !== order.status) {
      assertPurchaseOrderTransition(order.status, status);
      const [updated] = await tx.db
        .update(schema.purchaseOrders)
        .set({ status })
        .where(eq(schema.purchaseOrders.id, order.id))
        .returning();
      current = updated!;
    }
    return { receiptId: receipt!.id, order: current };
  });
}

// An order's receipts, oldest first, read in the caller's transaction.
export async function receiptsOf(tx: Tx, orderId: string): Promise<ReceiptView[]> {
  const { purchaseReceipts, purchaseReceiptLines } = schema;
  const receipts = await tx.db
    .select()
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.orderId, orderId))
    .orderBy(asc(purchaseReceipts.createdAt), asc(purchaseReceipts.id));
  if (receipts.length === 0) return [];
  const lines = await tx.db
    .select()
    .from(purchaseReceiptLines)
    .where(
      inArray(
        purchaseReceiptLines.receiptId,
        receipts.map((receipt) => receipt.id),
      ),
    );
  return receipts.map((receipt) => ({
    id: receipt.id,
    receivedDate: receipt.receivedDate,
    notes: receipt.notes,
    createdAt: receipt.createdAt,
    lines: lines
      .filter((line) => line.receiptId === receipt.id)
      .map((line) => ({
        orderLineId: line.orderLineId,
        quantity: line.quantity,
        moved: line.movementId !== null,
      })),
  }));
}
