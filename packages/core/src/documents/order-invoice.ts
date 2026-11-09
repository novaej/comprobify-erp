import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import { returnHoldToOrder, transferOrderHold } from '../inventory';
import {
  amountInput,
  Dec,
  DomainError,
  money,
  preciseInput,
  requireFeature,
  requirePermission,
  toSriAmount,
  type ActorContext,
} from '../kernel';
import { documentTotals, rideData, SRI_PAYMENT_METHODS, SRI_TERM_UNITS } from '../sri';
import {
  documentIdsOfOrder,
  invoiceContent,
  linkInvoice,
  orderForInvoicing,
  orderOfDocument,
  syncSaleOrder,
  type LineCoverage,
} from '../sales';
import { findIdempotent, type IssueDeps, type IssuedDocument } from './compose';
import {
  composeInvoice,
  correctDocument,
  invoiceInput,
  issueInvoice,
  type ParsedInvoice,
} from './create-invoice';
import { documentActions, documentNumber } from './queries';

// FR-SAL-3, FR-SAL-6, FR-SAL-7 (ADR-022): an invoice made from some of a sale order's lines.

const quantity = preciseInput.refine((value) => new Dec(value).gt(0), 'Must be more than 0');

export const orderInvoiceInput = z.object({
  orderId: z.uuid(),
  issuePointId: z.uuid(),
  // Which lines, and how much of each; never more than is left (FR-SAL-3).
  lines: z
    .array(z.object({ orderLineId: z.uuid(), quantity }))
    .min(1)
    .max(200),
  // The payment is chosen when invoicing: formaPago and plazo (FR-SAL-3). A single payment
  // with no amount carries the whole total, which core works out from the order's prices.
  payments: z
    .array(
      z.object({
        method: z.enum(SRI_PAYMENT_METHODS),
        amount: amountInput.nullable().default(null),
        term: z.int().min(0).max(9999).nullable().default(null),
        termUnit: z.enum(SRI_TERM_UNITS).nullable().default(null),
      }),
    )
    .min(1)
    .max(10),
  additionalInfo: invoiceInput.shape.additionalInfo,
  idempotencyKey: invoiceInput.shape.idempotencyKey,
});
export type OrderInvoiceInput = z.input<typeof orderInvoiceInput>;

export const orderInvoiceCorrectionInput = orderInvoiceInput.omit({
  orderId: true,
  issuePointId: true,
  idempotencyKey: true,
});
export type OrderInvoiceCorrectionInput = z.input<typeof orderInvoiceCorrectionInput>;

type Requested = z.output<typeof orderInvoiceCorrectionInput>['lines'];

// The invoice's lines from the order's, at the order's prices. A line's discount is shared out
// by quantity, and rounded so the parts of a line add up to its discount (FR-SAL-3).
function invoiceLines(coverage: LineCoverage[], requested: Requested) {
  const byId = new Map(coverage.map((entry) => [entry.line.id, entry]));
  const seen = new Set<string>();
  const lines: ParsedInvoice['lines'] = [];
  const links: { orderLineId: string; quantity: string }[] = [];
  for (const [index, given] of requested.entries()) {
    const entry = byId.get(given.orderLineId);
    if (!entry || seen.has(given.orderLineId))
      throw new DomainError('ORDER_LINE_UNKNOWN', 'The order has no such line', {
        line: index + 1,
      });
    seen.add(given.orderLineId);
    const { line } = entry;
    const wanted = new Dec(given.quantity);
    if (wanted.gt(entry.left))
      throw new DomainError(
        'ORDER_QUANTITY_EXCEEDED',
        'A line invoices more than the order has left',
        {
          position: line.position,
          left: entry.left.toFixed(6),
        },
      );
    const total = new Dec(line.quantity);
    const before = entry.invoiced;
    const share = (covered: Dec) => money(new Dec(line.discount).mul(covered).div(total));
    const portion = share(before.add(wanted)).sub(share(before));
    const cap = money(wanted.mul(line.unitPrice));
    lines.push({
      productId: line.productId,
      code: line.code,
      auxiliaryCode: null,
      name: line.name,
      unit: line.unit,
      quantity: given.quantity,
      unitPrice: line.unitPrice,
      discount: toSriAmount(Dec.min(portion, cap)),
      ivaRateCode: line.ivaRateCode,
      additionalDetails: [],
    });
    links.push({ orderLineId: line.id, quantity: given.quantity });
  }
  return { lines, links };
}

// Payments with amounts: a single one without gets the invoice's total (FR-SAL-3).
function resolvePayments(
  payments: z.output<typeof orderInvoiceCorrectionInput>['payments'],
  lines: ParsedInvoice['lines'],
) {
  if (payments.every((payment) => payment.amount !== null))
    return payments as ((typeof payments)[number] & { amount: string })[];
  if (payments.length !== 1)
    throw new DomainError('PAYMENT_AMOUNT_REQUIRED', 'Several payments each need an amount');
  const { total } = documentTotals(lines);
  return [{ ...payments[0]!, amount: toSriAmount(total) }];
}

// The order's lines go to an invoice of their own (the direct invoice calls the same pipeline,
// FR-SAL-7), in one transaction: the document, its link to the order, the order's hold passed to
// the invoice, the quota and the send job (FR-SAL-6).
export async function invoiceSaleOrder(
  ctx: ActorContext,
  db: Database,
  raw: OrderInvoiceInput,
  deps: IssueDeps,
): Promise<IssuedDocument> {
  requirePermission(ctx, 'documents.issue');
  requireFeature(ctx, 'SALE_ORDERS');
  requirePermission(ctx, 'sales.manage');
  const input = orderInvoiceInput.parse(raw);
  const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    // A retry with the same key finds its document before the quantities are checked again.
    const existing = await findIdempotent(tx, ctx, input.idempotencyKey, payloadHash);
    if (existing) return existing;

    const { order, lines: coverage } = await orderForInvoicing(tx, input.orderId);
    const built = invoiceLines(coverage, input.lines);
    const content = invoiceInput.parse({
      issuePointId: input.issuePointId,
      clientId: order.clientId,
      lines: built.lines,
      payments: resolvePayments(input.payments, built.lines),
      additionalInfo: input.additionalInfo,
      idempotencyKey: input.idempotencyKey,
    });
    const issued = await issueInvoice(
      ctx,
      tx,
      content,
      payloadHash,
      deps,
      { orderId: order.id, warehouseId: order.warehouseId },
      (document) =>
        linkInvoice(tx, { order, documentId: document.id, revision: 1, lines: built.links }),
    );
    await syncSaleOrder(tx, order.id);
    return issued;
  });
}

// FR-DOC-7 for an invoice made from an order: the same row and number, with lines picked from
// what the order has left, not counting this invoice's own (FR-SAL-4). Its hold goes back to the
// order and is passed again with the new lines.
export async function correctOrderInvoice(
  ctx: ActorContext,
  db: Database,
  documentId: string,
  raw: OrderInvoiceCorrectionInput,
  deps: IssueDeps,
): Promise<IssuedDocument> {
  requireFeature(ctx, 'SALE_ORDERS');
  requirePermission(ctx, 'sales.manage');
  const input = orderInvoiceCorrectionInput.parse(raw);
  return correctDocument(
    ctx,
    db,
    documentId,
    '01',
    async (tx, row, issuer, numbering) => {
      const orderId = await orderOfDocument(tx, row.id);
      if (!orderId)
        throw new DomainError('NOT_ORDER_INVOICE', 'This invoice was not made from an order');
      const { order, lines: coverage } = await orderForInvoicing(tx, orderId, row.id);
      const built = invoiceLines(coverage, input.lines);
      const composed = await composeInvoice(
        ctx,
        tx,
        {
          clientId: order.clientId,
          clientChanges: null,
          lines: built.lines,
          payments: resolvePayments(input.payments, built.lines),
          additionalInfo: input.additionalInfo,
        },
        issuer,
        numbering,
        deps,
      );
      await linkInvoice(tx, {
        order,
        documentId: row.id,
        revision: row.revision + 1,
        lines: built.links,
      });
      await returnHoldToOrder(
        tx,
        { tenantId: ctx.tenantId, userId: ctx.userId ?? null },
        {
          orderId,
          documentId: row.id,
        },
      );
      await transferOrderHold(ctx, tx, {
        orderId,
        documentId: row.id,
        warehouseId: order.warehouseId,
        lines: built.lines,
      });
      return composed;
    },
    deps,
  );
}

export type OrderInvoiceRow = {
  id: string;
  number: string;
  status: string;
  issueDate: string;
  total: string;
};

// The invoices made from an order, oldest first (FR-SAL-3).
export async function saleOrderInvoices(
  ctx: ActorContext,
  db: Database,
  orderId: string,
): Promise<OrderInvoiceRow[]> {
  requirePermission(ctx, 'documents.read');
  const id = z.uuid().parse(orderId);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const ids = await documentIdsOfOrder(tx, id);
    if (ids.length === 0) return [];
    const rows = await tx.db
      .select()
      .from(schema.documents)
      .where(inArray(schema.documents.id, ids));
    return rows
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((row) => ({
        id: row.id,
        number: documentNumber(row.series, row.sequential),
        status: row.status,
        issueDate: row.issueDate,
        total: row.total,
      }));
  });
}

export type OrderInvoiceDraft = {
  id: string;
  number: string;
  issuePointId: string;
  issuePoint: string;
  order: { id: string; number: number; warehouseId: string };
  // What each order line has left, not counting this invoice, and what it covers now.
  lines: {
    orderLineId: string;
    position: number;
    code: string;
    name: string;
    unit: string | null;
    unitPrice: string;
    discount: string;
    ivaRateCode: string;
    quantity: string;
    left: string;
    current: string;
  }[];
  payments: { method: string; amount: string; term: number | null; termUnit: string | null }[];
  additionalInfo: { name: string; value: string }[];
};

// FR-DOC-7: what the order correction form starts from: the invoice as last signed, over what
// its order has left.
export async function orderInvoiceDraft(
  ctx: ActorContext,
  db: Database,
  documentId: string,
): Promise<OrderInvoiceDraft> {
  requirePermission(ctx, 'documents.issue');
  const id = z.uuid().parse(documentId);
  const { documents, documentPayments } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const [row] = await tx.db.select().from(documents).where(eq(documents.id, id));
    if (
      !row ||
      row.documentType !== '01' ||
      (ctx.issuePointIds !== null && !ctx.issuePointIds.includes(row.issuePointId))
    )
      throw new DomainError('NOT_FOUND', 'Document not found');
    if (!documentActions(ctx, row).correct)
      throw new DomainError('NOT_CORRECTABLE', 'This document can not be corrected now');
    const orderId = await orderOfDocument(tx, id);
    if (!orderId)
      throw new DomainError('NOT_ORDER_INVOICE', 'This invoice was not made from an order');
    const { order, lines } = await orderForInvoicing(tx, orderId, id, false);
    const current = new Map(
      (await invoiceContent(tx, id, row.revision)).map((entry) => [
        entry.orderLineId,
        entry.quantity,
      ]),
    );
    const payments = await tx.db
      .select()
      .from(documentPayments)
      .where(and(eq(documentPayments.documentId, id), eq(documentPayments.revision, row.revision)))
      .orderBy(asc(documentPayments.position));
    const added = new Set(['Email', 'RUC Proveedor']);
    return {
      id: row.id,
      number: documentNumber(row.series, row.sequential),
      issuePointId: row.issuePointId,
      issuePoint: `${row.series.slice(0, 3)}-${row.series.slice(3)}`,
      order: { id: order.id, number: order.number, warehouseId: order.warehouseId },
      lines: lines.map(({ line, left }) => ({
        orderLineId: line.id,
        position: line.position,
        code: line.code,
        name: line.name,
        unit: line.unit,
        unitPrice: line.unitPrice,
        discount: line.discount,
        ivaRateCode: line.ivaRateCode,
        quantity: line.quantity,
        left: left.toFixed(6),
        current: current.get(line.id) ?? '0',
      })),
      payments: payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        term: payment.term,
        termUnit: payment.termUnit,
      })),
      additionalInfo: row.signedXml
        ? rideData(row.signedXml).additionalInfo.filter((field) => !added.has(field.name))
        : [],
    };
  });
}

// FR-SAL-9: the guías de remisión that go with the order's invoices, oldest first. A guía is made
// from an invoice, so the order's are the ones that name one of its invoices (ADR-023).
export async function saleOrderGuides(
  ctx: ActorContext,
  db: Database,
  orderId: string,
): Promise<OrderInvoiceRow[]> {
  requirePermission(ctx, 'documents.read');
  const id = z.uuid().parse(orderId);
  const { documents } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const invoiceIds = await documentIdsOfOrder(tx, id);
    if (invoiceIds.length === 0) return [];
    const rows = await tx.db
      .select()
      .from(documents)
      .where(
        and(eq(documents.documentType, '06'), inArray(documents.relatedDocumentId, invoiceIds)),
      );
    return rows
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((row) => ({
        id: row.id,
        number: documentNumber(row.series, row.sequential),
        status: row.status,
        issueDate: row.issueDate,
        total: row.total,
      }));
  });
}
