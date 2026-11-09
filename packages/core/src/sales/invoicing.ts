import { and, asc, eq, inArray, ne, schema, sql, type Tx } from '@comprobify/db';
import { Dec, DomainError } from '../kernel';
import { lockOrder, readOrder, type SaleOrder } from './shared';
import { assertSaleOrderTransition, type SaleOrderStatus } from './status';

// FR-SAL-3, FR-SAL-4 (ADR-022): how much of each order line the order's invoices cover.

type OrderLine = typeof schema.saleOrderLines.$inferSelect;

export type LineCoverage = {
  line: OrderLine;
  // Covered by invoices that aren't voided: authorized, in flight or failed. A failed invoice
  // keeps its quantities, since it is corrected, not replaced.
  invoiced: Dec;
  // Covered by authorized invoices, which is what finishes the order.
  authorized: Dec;
  left: Dec;
};

// The order's current lines with what covers them. Reading the invoices' statuses is a join on
// `documents`, kept to this one query so a status is never copied into the order's tables.
// `except` leaves one document out: the invoice being corrected doesn't hold against itself.
export async function coverageOf(
  tx: Tx,
  order: SaleOrder,
  except: string | null = null,
): Promise<LineCoverage[]> {
  const { saleOrderLines: lines, saleOrderInvoiceLines: links, documents } = schema;
  const covered = await tx.db
    .select({
      lineId: links.orderLineId,
      invoiced: sql<string>`coalesce(sum(${links.quantity}) FILTER (WHERE ${documents.status} <> 'VOIDED'), 0)`,
      authorized: sql<string>`coalesce(sum(${links.quantity}) FILTER (WHERE ${documents.status} = 'AUTHORIZED'), 0)`,
    })
    .from(links)
    .innerJoin(
      documents,
      and(
        eq(documents.tenantId, links.tenantId),
        eq(documents.id, links.documentId),
        // Only the revision in force counts.
        eq(documents.revision, links.documentRevision),
      ),
    )
    .where(
      and(
        eq(links.tenantId, order.tenantId),
        eq(links.orderId, order.id),
        except ? ne(links.documentId, except) : undefined,
      ),
    )
    .groupBy(links.orderLineId);
  const byLine = new Map(covered.map((row) => [row.lineId, row]));
  const current = await tx.db
    .select()
    .from(lines)
    .where(and(eq(lines.orderId, order.id), eq(lines.revision, order.revision)))
    .orderBy(asc(lines.position));
  return current.map((line) => {
    const invoiced = new Dec(byLine.get(line.id)?.invoiced ?? 0);
    return {
      line,
      invoiced,
      authorized: new Dec(byLine.get(line.id)?.authorized ?? 0),
      left: new Dec(line.quantity).sub(invoiced),
    };
  });
}

// The order, locked, with what is left of each line to invoice (FR-SAL-3).
export async function orderForInvoicing(
  tx: Tx,
  orderId: string,
  except: string | null = null,
  // A page reading what is left doesn't hold the order; invoicing does.
  lock = true,
): Promise<{ order: SaleOrder; lines: LineCoverage[] }> {
  const order = lock ? await lockOrder(tx, orderId) : await readOrder(tx, orderId);
  if (order.status === 'DRAFT' || order.status === 'CANCELLED')
    throw new DomainError('ORDER_NOT_INVOICEABLE', 'Only a confirmed order can be invoiced', {
      status: order.status,
    });
  return { order, lines: await coverageOf(tx, order, except) };
}

export async function linkInvoice(
  tx: Tx,
  input: {
    order: SaleOrder;
    documentId: string;
    revision: number;
    lines: { orderLineId: string; quantity: string }[];
  },
): Promise<void> {
  await tx.db.insert(schema.saleOrderInvoiceLines).values(
    input.lines.map((line) => ({
      tenantId: input.order.tenantId,
      orderId: input.order.id,
      orderLineId: line.orderLineId,
      documentId: input.documentId,
      documentRevision: input.revision,
      quantity: line.quantity,
    })),
  );
}

// The order a document was made from, if any.
export async function orderOfDocument(tx: Tx, documentId: string): Promise<string | null> {
  const [row] = await tx.db
    .select({ orderId: schema.saleOrderInvoiceLines.orderId })
    .from(schema.saleOrderInvoiceLines)
    .where(eq(schema.saleOrderInvoiceLines.documentId, documentId))
    .limit(1);
  return row?.orderId ?? null;
}

// What a document covers on its order at one revision, with the order line's content.
export async function invoiceContent(
  tx: Tx,
  documentId: string,
  revision: number,
): Promise<{ orderLineId: string; quantity: string }[]> {
  const links = schema.saleOrderInvoiceLines;
  return tx.db
    .select({ orderLineId: links.orderLineId, quantity: links.quantity })
    .from(links)
    .where(and(eq(links.documentId, documentId), eq(links.documentRevision, revision)));
}

// The order's status follows its invoices (FR-SAL-4): INVOICED once authorized invoices cover
// every line, PARTIALLY_INVOICED while anything is covered, CONFIRMED when nothing is (all
// voided). It runs in the transaction of whatever changed a document's coverage or status.
export async function syncSaleOrder(tx: Tx, orderId: string): Promise<SaleOrderStatus> {
  const order = await lockOrder(tx, orderId);
  if (order.status === 'DRAFT' || order.status === 'CANCELLED') return order.status;
  const coverage = await coverageOf(tx, order);
  const target: SaleOrderStatus = coverage.every((entry) =>
    entry.authorized.gte(entry.line.quantity),
  )
    ? 'INVOICED'
    : coverage.some((entry) => entry.invoiced.gt(0))
      ? 'PARTIALLY_INVOICED'
      : 'CONFIRMED';
  if (target === order.status) return target;
  assertSaleOrderTransition(order.status, target);
  await tx.db
    .update(schema.saleOrders)
    .set({ status: target })
    .where(eq(schema.saleOrders.id, order.id));
  return target;
}

// The order a document was made from, for showing the link: its id and number.
export async function orderRefOfDocument(
  tx: Tx,
  documentId: string,
): Promise<{ id: string; number: number } | null> {
  const { saleOrders, saleOrderInvoiceLines: links } = schema;
  const [row] = await tx.db
    .select({ id: saleOrders.id, number: saleOrders.number })
    .from(links)
    .innerJoin(
      saleOrders,
      and(eq(saleOrders.tenantId, links.tenantId), eq(saleOrders.id, links.orderId)),
    )
    .where(eq(links.documentId, documentId))
    .limit(1);
  return row ?? null;
}

// The documents made from an order, oldest first.
export async function documentIdsOfOrder(tx: Tx, orderId: string): Promise<string[]> {
  const links = schema.saleOrderInvoiceLines;
  const rows = await tx.db
    .selectDistinct({ documentId: links.documentId })
    .from(links)
    .where(eq(links.orderId, orderId));
  return rows.map((row) => row.documentId);
}

// How many of these ids are orders of this company (the tenant's own, by RLS): a batch checks
// its list is whole before queuing anything (ADR-026).
export async function countSaleOrders(tx: Tx, orderIds: string[]): Promise<number> {
  const [row] = await tx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.saleOrders)
    .where(inArray(schema.saleOrders.id, orderIds));
  return row!.count;
}
