import {
  and,
  asc,
  desc,
  eq,
  ilike,
  or,
  schema,
  sql,
  type Database,
  type PurchaseOrderStatus,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { productsForOrder } from '../catalog';
import {
  Dec,
  DomainError,
  ecuadorDate,
  money,
  preciseInput,
  toSriAmount,
  type ActorContext,
} from '../kernel';
import { providerForOrder } from '../parties';
import { lineAmounts } from '../sri';
import { nextNumber, warehousesOf, type Warehouse } from '../tenancy';
import { receiptsOf, type ReceiptView } from './receipts';
import {
  canManage,
  canRead,
  lockOrder,
  movesStock,
  optionalText,
  positive,
  type PurchaseOrder,
} from './shared';
import { assertPurchaseOrderTransition, PURCHASE_ORDER_STATUSES } from './status';

// FR-PUR-1 (ADR-019): what the company asks a provider for, at a cost without IVA, to arrive
// at one warehouse. Editable while a draft; after that only its status moves.

export const purchaseOrderInput = z.object({
  providerId: z.uuid(),
  warehouseId: z.uuid(),
  expectedDate: z.iso.date().nullable().default(null),
  notes: optionalText(1000),
  lines: z
    .array(z.object({ productId: z.uuid(), quantity: positive, unitCost: preciseInput }))
    .min(1)
    .max(200),
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderInput>;

export type { PurchaseOrder };
export type PurchaseOrderLine = typeof schema.purchaseOrderLines.$inferSelect;

type PricedLine = Omit<
  typeof schema.purchaseOrderLines.$inferInsert,
  'tenantId' | 'orderId' | 'revision' | 'position'
>;

// Lines priced as SRI rounds them (ADR-012), the product as it is now.
async function priceLines(tx: Tx, lines: z.output<typeof purchaseOrderInput>['lines']) {
  const products = new Map(
    (await productsForOrder(tx, [...new Set(lines.map((line) => line.productId))])).map(
      (product) => [product.id, product],
    ),
  );
  const priced: PricedLine[] = lines.map((line, index) => {
    const product = products.get(line.productId);
    if (!product) throw new DomainError('NOT_FOUND', 'Product not found', { line: index + 1 });
    if (!product.active)
      throw new DomainError('PRODUCT_INACTIVE', 'This product is inactive', { line: index + 1 });
    const amounts = lineAmounts({
      quantity: line.quantity,
      unitPrice: line.unitCost,
      discount: 0,
      ivaRateCode: product.ivaRateCode,
    });
    return {
      productId: product.id,
      code: product.code,
      name: product.name,
      unit: product.unit,
      quantity: line.quantity,
      unitCost: line.unitCost,
      ivaRateCode: product.ivaRateCode,
      subtotal: toSriAmount(amounts.base),
      iva: toSriAmount(amounts.iva),
    };
  });
  const subtotal = priced.reduce((sum, line) => sum.add(line.subtotal), new Dec(0));
  const iva = priced.reduce((sum, line) => sum.add(line.iva), new Dec(0));
  return {
    lines: priced,
    totals: {
      subtotal: toSriAmount(money(subtotal)),
      iva: toSriAmount(money(iva)),
      total: toSriAmount(money(subtotal.add(iva))),
    },
  };
}

async function activeWarehouse(tx: Tx, warehouseId: string): Promise<Warehouse> {
  const warehouse = (await warehousesOf(tx)).find((item) => item.id === warehouseId);
  if (!warehouse) throw new DomainError('NOT_FOUND', 'Warehouse not found');
  if (!warehouse.active) throw new DomainError('WAREHOUSE_INACTIVE', 'This warehouse is inactive');
  return warehouse;
}

function checkExpected(orderDate: string, expectedDate: string | null) {
  if (expectedDate && expectedDate < orderDate)
    throw new DomainError('EXPECTED_BEFORE_ORDER', 'The expected date is before the order date', {
      orderDate,
    });
}

async function insertLines(
  ctx: ActorContext,
  tx: Tx,
  orderId: string,
  revision: number,
  lines: PricedLine[],
) {
  await tx.db.insert(schema.purchaseOrderLines).values(
    lines.map((line, index) => ({
      ...line,
      tenantId: ctx.tenantId,
      orderId,
      revision,
      position: index + 1,
    })),
  );
}

export async function createPurchaseOrder(
  ctx: ActorContext,
  db: Database,
  raw: PurchaseOrderInput,
): Promise<PurchaseOrder> {
  canManage(ctx);
  const input = purchaseOrderInput.parse(raw);
  const orderDate = ecuadorDate(ctx.clock.now());
  checkExpected(orderDate, input.expectedDate);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    await providerForOrder(ctx, tx, input.providerId);
    await activeWarehouse(tx, input.warehouseId);
    const { lines, totals } = await priceLines(tx, input.lines);
    const number = await nextNumber(tx, ctx.tenantId, 'PURCHASE_ORDER');
    const [order] = await tx.db
      .insert(schema.purchaseOrders)
      .values({
        tenantId: ctx.tenantId,
        number,
        providerId: input.providerId,
        warehouseId: input.warehouseId,
        orderDate,
        expectedDate: input.expectedDate,
        notes: input.notes,
        ...totals,
        createdBy: ctx.userId ?? null,
      })
      .returning();
    await insertLines(ctx, tx, order!.id, 1, lines);
    return order!;
  });
}

// A draft's new content: its lines become a new revision, the old ones stay (rule 12).
export async function updatePurchaseOrder(
  ctx: ActorContext,
  db: Database,
  id: string,
  raw: PurchaseOrderInput,
): Promise<PurchaseOrder> {
  canManage(ctx);
  const orderId = z.uuid().parse(id);
  const input = purchaseOrderInput.parse(raw);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== 'DRAFT')
      throw new DomainError('ORDER_NOT_DRAFT', 'Only a draft can be edited');
    checkExpected(order.orderDate, input.expectedDate);
    if (input.providerId !== order.providerId) await providerForOrder(ctx, tx, input.providerId);
    if (input.warehouseId !== order.warehouseId) await activeWarehouse(tx, input.warehouseId);
    const { lines, totals } = await priceLines(tx, input.lines);
    const revision = order.revision + 1;
    const [updated] = await tx.db
      .update(schema.purchaseOrders)
      .set({
        providerId: input.providerId,
        warehouseId: input.warehouseId,
        expectedDate: input.expectedDate,
        notes: input.notes,
        revision,
        ...totals,
      })
      .where(eq(schema.purchaseOrders.id, orderId))
      .returning();
    await insertLines(ctx, tx, orderId, revision, lines);
    return updated!;
  });
}

async function moveOrder(
  ctx: ActorContext,
  db: Database,
  id: string,
  to: PurchaseOrderStatus,
  set: Partial<typeof schema.purchaseOrders.$inferInsert> = {},
): Promise<PurchaseOrder> {
  canManage(ctx);
  const orderId = z.uuid().parse(id);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const order = await lockOrder(tx, orderId);
    assertPurchaseOrderTransition(order.status, to);
    const [updated] = await tx.db
      .update(schema.purchaseOrders)
      .set({ status: to, ...set })
      .where(eq(schema.purchaseOrders.id, orderId))
      .returning();
    return updated!;
  });
}

// Sent to the provider: by email (FR-PUR-3) or any other way, and no longer editable.
export const markPurchaseOrderSent = (ctx: ActorContext, db: Database, id: string) =>
  moveOrder(ctx, db, id, 'SENT', { sentAt: ctx.clock.now() });

export const cancelPurchaseOrderInput = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1).max(300),
});

// Before anything arrives; once goods are in, the order is closed instead.
export async function cancelPurchaseOrder(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof cancelPurchaseOrderInput>,
): Promise<PurchaseOrder> {
  const input = cancelPurchaseOrderInput.parse(raw);
  return moveOrder(ctx, db, input.id, 'CANCELLED', {
    cancelledAt: ctx.clock.now(),
    cancelReason: input.reason,
  });
}

// Done with it: everything arrived, or the rest won't.
export const closePurchaseOrder = (ctx: ActorContext, db: Database, id: string) =>
  moveOrder(ctx, db, id, 'CLOSED', { closedAt: ctx.clock.now() });

export const purchaseOrderFilters = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  query: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type PurchaseOrderFilters = z.input<typeof purchaseOrderFilters>;

export type PurchaseOrderRow = {
  id: string;
  number: number;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  providerName: string;
  total: string;
};

const PAGE_SIZE = 50;

// Newest first; a search matches the provider or the number.
export async function listPurchaseOrders(
  ctx: ActorContext,
  db: Database,
  raw: PurchaseOrderFilters = {},
): Promise<{ rows: PurchaseOrderRow[]; total: number; page: number; pageSize: number }> {
  canRead(ctx);
  const filters = purchaseOrderFilters.parse(raw);
  const { purchaseOrders, providers } = schema;
  const query = filters.query?.replace(/^oc-?/i, '');
  const pattern = query ? `%${query.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const number = query && /^\d{1,9}$/.test(query) ? Number(query) : null;
  const where = and(
    filters.status ? eq(purchaseOrders.status, filters.status) : undefined,
    pattern
      ? or(
          ilike(providers.name, pattern),
          ilike(providers.identification, pattern),
          number === null ? undefined : eq(purchaseOrders.number, number),
        )
      : undefined,
  );
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const join = and(
      eq(providers.tenantId, purchaseOrders.tenantId),
      eq(providers.id, purchaseOrders.providerId),
    );
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .innerJoin(providers, join)
      .where(where);
    const rows = await tx
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        orderDate: purchaseOrders.orderDate,
        expectedDate: purchaseOrders.expectedDate,
        providerName: providers.name,
        total: purchaseOrders.total,
      })
      .from(purchaseOrders)
      .innerJoin(providers, join)
      .where(where)
      .orderBy(desc(purchaseOrders.number))
      .limit(PAGE_SIZE)
      .offset((filters.page - 1) * PAGE_SIZE);
    return { rows, total: count!.total, page: filters.page, pageSize: PAGE_SIZE };
  });
}

export type PurchaseOrderView = PurchaseOrder & {
  provider: { id: string; idType: string; identification: string; name: string; emails: string[] };
  warehouse: Warehouse;
  // What is still to arrive, and whether receiving it moves stock (FR-PUR-2).
  lines: (PurchaseOrderLine & { left: string; stocked: boolean })[];
  receipts: ReceiptView[];
};

export async function getPurchaseOrder(
  ctx: ActorContext,
  db: Database,
  id: string,
): Promise<PurchaseOrderView> {
  canRead(ctx);
  const orderId = z.uuid().parse(id);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const [order] = await tx.db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, orderId));
    if (!order) throw new DomainError('NOT_FOUND', 'Purchase order not found');
    // The provider as it is now, inactive or not: the order still shows who it was for.
    const [provider] = await tx.db
      .select({
        id: schema.providers.id,
        idType: schema.providers.idType,
        identification: schema.providers.identification,
        name: schema.providers.name,
        emails: schema.providers.emails,
      })
      .from(schema.providers)
      .where(eq(schema.providers.id, order.providerId));
    const warehouse = (await warehousesOf(tx)).find((item) => item.id === order.warehouseId);
    const lines = await tx.db
      .select()
      .from(schema.purchaseOrderLines)
      .where(
        and(
          eq(schema.purchaseOrderLines.orderId, orderId),
          eq(schema.purchaseOrderLines.revision, order.revision),
        ),
      )
      .orderBy(asc(schema.purchaseOrderLines.position));
    const receipts = await receiptsOf(tx, orderId);
    const products = new Map(
      (
        await productsForOrder(
          tx,
          lines.map((line) => line.productId),
        )
      ).map((product) => [product.id, product]),
    );
    return {
      ...order,
      provider: provider!,
      warehouse: warehouse!,
      lines: lines.map((line) => ({
        ...line,
        left: new Dec(line.quantity).sub(line.receivedQuantity).toFixed(6),
        stocked: movesStock(ctx, products.get(line.productId)),
      })),
      receipts,
    };
  });
}

// Where a new order's goods can go: the company's active warehouses.
export async function orderWarehouses(ctx: ActorContext, db: Database): Promise<Warehouse[]> {
  canManage(ctx);
  const all = await db.withTenant({ tenantId: ctx.tenantId }, (tx) => warehousesOf(tx));
  return all.filter((warehouse) => warehouse.active);
}
