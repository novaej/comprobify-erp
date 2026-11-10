import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  schema,
  sql,
  type Database,
  type SaleOrderStatus,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { productsForOrder } from '../catalog';
import { releaseDocumentStock, reserveDocumentStock } from '../inventory';
import {
  amountInput,
  Dec,
  DomainError,
  ecuadorDate,
  preciseInput,
  toSriAmount,
  type ActorContext,
} from '../kernel';
import { buyerForDocument } from '../parties';
import { documentTotals, lineAmounts } from '../sri';
import { nextNumber, warehousesOf, type Warehouse } from '../tenancy';
import { coverageOf } from './invoicing';
import { canManage, canRead, lockOrder, optionalText, positive, type SaleOrder } from './shared';
import { assertSaleOrderTransition, SALE_ORDER_STATUSES } from './status';

// FR-SAL-1, FR-SAL-2 (ADR-021): what a client asks for, at a price, from one warehouse. A draft
// holds nothing; confirming holds the goods that track stock, and cancelling lets them go.

export const saleOrderInput = z.object({
  // Null is consumidor final.
  clientId: z.uuid().nullable().default(null),
  warehouseId: z.uuid(),
  notes: optionalText(1000),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: positive,
        unitPrice: preciseInput,
        discount: amountInput.default('0'),
      }),
    )
    .min(1)
    .max(200),
});
export type SaleOrderInput = z.input<typeof saleOrderInput>;

export type { SaleOrder };
export type SaleOrderLine = typeof schema.saleOrderLines.$inferSelect;

type PricedLine = Omit<
  typeof schema.saleOrderLines.$inferInsert,
  'tenantId' | 'orderId' | 'revision' | 'position'
>;

// Lines priced as SRI rounds them (ADR-012), so the order's total is the invoice's.
async function priceLines(tx: Tx, lines: z.output<typeof saleOrderInput>['lines']) {
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
    if (new Dec(line.quantity).mul(line.unitPrice).lt(line.discount))
      throw new DomainError('LINE_DISCOUNT_TOO_LARGE', 'A discount exceeds its line', {
        line: index + 1,
      });
    const amounts = lineAmounts({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ivaRateCode: product.ivaRateCode,
    });
    return {
      productId: product.id,
      code: product.code,
      name: product.name,
      unit: product.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: toSriAmount(new Dec(line.discount)),
      ivaRateCode: product.ivaRateCode,
      ivaPercent: amounts.ivaPercent.toString(),
      base: toSriAmount(amounts.base),
      iva: toSriAmount(amounts.iva),
    };
  });
  const totals = documentTotals(
    priced.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ivaRateCode: line.ivaRateCode,
    })),
  );
  return {
    lines: priced,
    totals: {
      subtotal: toSriAmount(totals.subtotal),
      iva: toSriAmount(totals.total.sub(totals.subtotal)),
      total: toSriAmount(totals.total),
    },
  };
}

async function activeWarehouse(tx: Tx, warehouseId: string): Promise<Warehouse> {
  const warehouse = (await warehousesOf(tx)).find((item) => item.id === warehouseId);
  if (!warehouse) throw new DomainError('NOT_FOUND', 'Warehouse not found');
  if (!warehouse.active) throw new DomainError('WAREHOUSE_INACTIVE', 'This warehouse is inactive');
  return warehouse;
}

async function insertLines(
  ctx: ActorContext,
  tx: Tx,
  orderId: string,
  revision: number,
  lines: PricedLine[],
) {
  await tx.db.insert(schema.saleOrderLines).values(
    lines.map((line, index) => ({
      ...line,
      tenantId: ctx.tenantId,
      orderId,
      revision,
      position: index + 1,
    })),
  );
}

// The goods of the order's current revision, for holding them.
async function currentLines(tx: Tx, order: SaleOrder) {
  return tx.db
    .select({
      productId: schema.saleOrderLines.productId,
      quantity: schema.saleOrderLines.quantity,
    })
    .from(schema.saleOrderLines)
    .where(
      and(
        eq(schema.saleOrderLines.orderId, order.id),
        eq(schema.saleOrderLines.revision, order.revision),
      ),
    );
}

async function hold(ctx: ActorContext, tx: Tx, order: SaleOrder) {
  await reserveDocumentStock(ctx, tx, {
    documentId: order.id,
    warehouseId: order.warehouseId,
    lines: await currentLines(tx, order),
    sourceType: 'SALE_ORDER',
  });
}

const release = (ctx: ActorContext, tx: Tx, order: SaleOrder) =>
  releaseDocumentStock(
    tx,
    { tenantId: ctx.tenantId, userId: ctx.userId ?? null },
    order.id,
    'SALE_ORDER',
  );

export async function createSaleOrder(
  ctx: ActorContext,
  db: Database,
  raw: SaleOrderInput,
): Promise<SaleOrder> {
  canManage(ctx);
  const input = saleOrderInput.parse(raw);
  const orderDate = ecuadorDate(ctx.clock.now());
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    if (input.clientId) await buyerForDocument(ctx, tx, input.clientId);
    await activeWarehouse(tx, input.warehouseId);
    const { lines, totals } = await priceLines(tx, input.lines);
    const number = await nextNumber(tx, ctx.tenantId, 'SALE_ORDER');
    const [order] = await tx.db
      .insert(schema.saleOrders)
      .values({
        tenantId: ctx.tenantId,
        number,
        clientId: input.clientId,
        warehouseId: input.warehouseId,
        orderDate,
        notes: input.notes,
        ...totals,
        createdBy: ctx.userId ?? null,
      })
      .returning();
    await insertLines(ctx, tx, order!.id, 1, lines);
    return order!;
  });
}

// New content as a new revision of the lines; the old ones stay (rule 12). A confirmed order
// lets its goods go and holds the new ones in the same transaction. Once an invoice covers it
// the order is no longer CONFIRMED, so it can't be edited: the path is a credit note (FR-SAL-5).
export async function updateSaleOrder(
  ctx: ActorContext,
  db: Database,
  id: string,
  raw: SaleOrderInput,
): Promise<SaleOrder> {
  canManage(ctx);
  const orderId = z.uuid().parse(id);
  const input = saleOrderInput.parse(raw);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== 'DRAFT' && order.status !== 'CONFIRMED')
      throw new DomainError(
        'ORDER_NOT_EDITABLE',
        'Only a draft or a confirmed order can be edited',
        {
          status: order.status,
        },
      );
    if (input.clientId && input.clientId !== order.clientId)
      await buyerForDocument(ctx, tx, input.clientId);
    if (input.warehouseId !== order.warehouseId) await activeWarehouse(tx, input.warehouseId);
    const { lines, totals } = await priceLines(tx, input.lines);
    if (order.status === 'CONFIRMED') await release(ctx, tx, order);
    const revision = order.revision + 1;
    const [updated] = await tx.db
      .update(schema.saleOrders)
      .set({
        clientId: input.clientId,
        warehouseId: input.warehouseId,
        notes: input.notes,
        revision,
        ...totals,
      })
      .where(eq(schema.saleOrders.id, orderId))
      .returning();
    await insertLines(ctx, tx, orderId, revision, lines);
    if (order.status === 'CONFIRMED') await hold(ctx, tx, updated!);
    return updated!;
  });
}

// Confirmed: the goods that track stock are held for the client, under the company's
// negative-stock rule (FR-SAL-2).
export async function confirmSaleOrder(
  ctx: ActorContext,
  db: Database,
  id: string,
): Promise<SaleOrder> {
  canManage(ctx);
  const orderId = z.uuid().parse(id);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const order = await lockOrder(tx, orderId);
    assertSaleOrderTransition(order.status, 'CONFIRMED');
    // The client or warehouse may have gone inactive since the draft was saved.
    if (order.clientId) await buyerForDocument(ctx, tx, order.clientId);
    await activeWarehouse(tx, order.warehouseId);
    const [updated] = await tx.db
      .update(schema.saleOrders)
      .set({ status: 'CONFIRMED', confirmedAt: ctx.clock.now() })
      .where(eq(schema.saleOrders.id, orderId))
      .returning();
    await hold(ctx, tx, updated!);
    return updated!;
  });
}

export const cancelSaleOrderInput = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1).max(300),
});

// From a draft or a confirmed order that nothing has been invoiced from; what it still holds
// is released (FR-SAL-1).
export async function cancelSaleOrder(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof cancelSaleOrderInput>,
): Promise<SaleOrder> {
  canManage(ctx);
  const input = cancelSaleOrderInput.parse(raw);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const order = await lockOrder(tx, input.id);
    assertSaleOrderTransition(order.status, 'CANCELLED');
    const [updated] = await tx.db
      .update(schema.saleOrders)
      .set({ status: 'CANCELLED', cancelledAt: ctx.clock.now(), cancelReason: input.reason })
      .where(eq(schema.saleOrders.id, input.id))
      .returning();
    await release(ctx, tx, order);
    return updated!;
  });
}

export const saleOrderFilters = z.object({
  status: z.enum(SALE_ORDER_STATUSES).optional(),
  query: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type SaleOrderFilters = z.input<typeof saleOrderFilters>;

export type SaleOrderRow = {
  id: string;
  number: number;
  status: SaleOrderStatus;
  orderDate: string;
  // Null is consumidor final.
  clientName: string | null;
  total: string;
};

const PAGE_SIZE = 50;

// What a batch can invoice: orders with something left (FR-BULK-1). A line's own quantities are
// checked when its turn comes, so an order fully covered by now fails alone.
const INVOICEABLE: SaleOrderStatus[] = ['CONFIRMED', 'PARTIALLY_INVOICED'];

function orderWhere(filters: z.output<typeof saleOrderFilters>, statuses?: SaleOrderStatus[]) {
  const { saleOrders, clients } = schema;
  const query = filters.query?.replace(/^pv-?/i, '');
  const pattern = query ? `%${query.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const number = query && /^\d{1,9}$/.test(query) ? Number(query) : null;
  return and(
    statuses ? inArray(saleOrders.status, statuses) : undefined,
    filters.status ? eq(saleOrders.status, filters.status) : undefined,
    pattern
      ? or(
          ilike(clients.name, pattern),
          ilike(clients.identification, pattern),
          number === null ? undefined : eq(saleOrders.number, number),
        )
      : undefined,
  );
}

async function listOrders(
  ctx: ActorContext,
  db: Database,
  raw: SaleOrderFilters,
  scope: { statuses?: SaleOrderStatus[]; oldestFirst?: boolean } = {},
): Promise<{ rows: SaleOrderRow[]; total: number; page: number; pageSize: number }> {
  canRead(ctx);
  const filters = saleOrderFilters.parse(raw);
  const { saleOrders, clients } = schema;
  const where = orderWhere(filters, scope.statuses);
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const join = and(
      eq(clients.tenantId, saleOrders.tenantId),
      eq(clients.id, saleOrders.clientId),
    );
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(saleOrders)
      .leftJoin(clients, join)
      .where(where);
    const rows = await tx
      .select({
        id: saleOrders.id,
        number: saleOrders.number,
        status: saleOrders.status,
        orderDate: saleOrders.orderDate,
        clientName: clients.name,
        total: saleOrders.total,
      })
      .from(saleOrders)
      .leftJoin(clients, join)
      .where(where)
      .orderBy(scope.oldestFirst ? asc(saleOrders.number) : desc(saleOrders.number))
      .limit(PAGE_SIZE)
      .offset((filters.page - 1) * PAGE_SIZE);
    return { rows, total: count!.total, page: filters.page, pageSize: PAGE_SIZE };
  });
}

// Newest first; a search matches the client or the number.
export const listSaleOrders = (ctx: ActorContext, db: Database, raw: SaleOrderFilters = {}) =>
  listOrders(ctx, db, raw);

// FR-BULK-1: the orders a batch can take, oldest first, searched the same way.
export const listInvoiceableOrders = (
  ctx: ActorContext,
  db: Database,
  raw: Pick<SaleOrderFilters, 'query' | 'page'> = {},
) => listOrders(ctx, db, raw, { statuses: INVOICEABLE, oldestFirst: true });

// All of them matching a search, for a batch of "everything shown" (at most `max`).
export async function invoiceableOrderIds(
  ctx: ActorContext,
  db: Database,
  raw: Pick<SaleOrderFilters, 'query'>,
  max: number,
): Promise<string[]> {
  canRead(ctx);
  const filters = saleOrderFilters.parse({ query: raw.query });
  const { saleOrders, clients } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const rows = await tx
      .select({ id: saleOrders.id })
      .from(saleOrders)
      .leftJoin(
        clients,
        and(eq(clients.tenantId, saleOrders.tenantId), eq(clients.id, saleOrders.clientId)),
      )
      .where(orderWhere(filters, INVOICEABLE))
      .orderBy(asc(saleOrders.number))
      .limit(max);
    return rows.map((row) => row.id);
  });
}

export type SaleOrderView = SaleOrder & {
  client: { id: string; idType: string; identification: string; name: string } | null;
  warehouse: Warehouse;
  // `invoiced` is covered by invoices that aren't voided (FR-SAL-3, FR-SAL-4).
  lines: (SaleOrderLine & { invoiced: string; left: string })[];
};

export async function getSaleOrder(
  ctx: ActorContext,
  db: Database,
  id: string,
): Promise<SaleOrderView> {
  canRead(ctx);
  const orderId = z.uuid().parse(id);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const [order] = await tx.db
      .select()
      .from(schema.saleOrders)
      .where(eq(schema.saleOrders.id, orderId));
    if (!order) throw new DomainError('NOT_FOUND', 'Sale order not found');
    // The client as it is now, inactive or not: the order still shows who it was for.
    const [client] = order.clientId
      ? await tx.db
          .select({
            id: schema.clients.id,
            idType: schema.clients.idType,
            identification: schema.clients.identification,
            name: schema.clients.name,
          })
          .from(schema.clients)
          .where(eq(schema.clients.id, order.clientId))
      : [];
    const warehouse = (await warehousesOf(tx)).find((item) => item.id === order.warehouseId);
    const coverage = await coverageOf(tx, order);
    return {
      ...order,
      client: client ?? null,
      warehouse: warehouse!,
      lines: coverage.map((entry) => ({
        ...entry.line,
        invoiced: entry.invoiced.toFixed(6),
        left: entry.left.toFixed(6),
      })),
    };
  });
}

// Where a new order's goods can come from: the company's active warehouses.
export async function saleOrderWarehouses(ctx: ActorContext, db: Database): Promise<Warehouse[]> {
  canManage(ctx);
  const all = await db.withTenant({ tenantId: ctx.tenantId }, (tx) => warehousesOf(tx));
  return all.filter((warehouse) => warehouse.active);
}
