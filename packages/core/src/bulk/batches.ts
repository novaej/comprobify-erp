import {
  and,
  asc,
  desc,
  eq,
  inArray,
  schema,
  sql,
  type BatchStatus,
  type Database,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { documentNumber } from '../documents';
import { DomainError, requireFeature, requirePermission, type ActorContext } from '../kernel';
import type { Jobs } from '../jobs';
import { countSaleOrders } from '../sales';
import { SRI_PAYMENT_METHODS, SRI_TERM_UNITS } from '../sri';
import { issuePointWarehouse } from '../tenancy';
import { itemView, type ItemView } from './status';

// FR-BULK-1, FR-BULK-3 (ADR-026).

// Past this a batch is a CSV import's job, not a form's: the list of ids alone is megabytes.
export const MAX_BATCH_ITEMS = 10_000;
const INSERT_CHUNK = 1000;

export const startOrderBatchInput = z.object({
  issuePointId: z.uuid(),
  orderIds: z.array(z.uuid()).min(1).max(MAX_BATCH_ITEMS),
  // One payment for each invoice's whole total, as the order invoice form offers (FR-SAL-3).
  payment: z.object({
    method: z.enum(SRI_PAYMENT_METHODS),
    term: z.int().min(0).max(9999).nullable().default(null),
    termUnit: z.enum(SRI_TERM_UNITS).nullable().default(null),
  }),
});
export type StartOrderBatchInput = z.input<typeof startOrderBatchInput>;

function canStart(ctx: ActorContext) {
  requireFeature(ctx, 'BULK_INVOICING');
  requireFeature(ctx, 'SALE_ORDERS');
  requirePermission(ctx, 'documents.issue');
  requirePermission(ctx, 'sales.manage');
}

function canRead(ctx: ActorContext) {
  requireFeature(ctx, 'BULK_INVOICING');
  requirePermission(ctx, 'documents.read');
}

// Many confirmed orders become one batch (FR-BULK-1). Nothing is made here: the items wait in
// the queue for the worker, one invoice each. An order that can't be invoiced when its turn
// comes fails alone, with its reason.
export async function startOrderBatch(
  ctx: ActorContext,
  db: Database,
  raw: StartOrderBatchInput,
  deps: { jobs: Pick<Jobs, 'enqueue'> },
): Promise<{ id: string; totalItems: number }> {
  canStart(ctx);
  const input = startOrderBatchInput.parse(raw);
  const orderIds = [...new Set(input.orderIds)];
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    try {
      await issuePointWarehouse(tx, input.issuePointId);
    } catch {
      throw new DomainError('NOT_FOUND', 'Issue point not found');
    }
    if ((await countSaleOrders(tx, orderIds)) !== orderIds.length)
      throw new DomainError('NOT_FOUND', 'Some of the sale orders do not exist');
    const [batch] = await tx.db
      .insert(schema.bulkBatches)
      .values({
        tenantId: ctx.tenantId,
        source: 'SALE_ORDERS',
        issuePointId: input.issuePointId,
        paymentMethod: input.payment.method,
        paymentTerm: input.payment.term,
        paymentTermUnit: input.payment.termUnit,
        totalItems: orderIds.length,
        createdBy: ctx.userId ?? null,
      })
      .returning({ id: schema.bulkBatches.id });
    for (let from = 0; from < orderIds.length; from += INSERT_CHUNK)
      await tx.db.insert(schema.bulkBatchItems).values(
        orderIds.slice(from, from + INSERT_CHUNK).map((saleOrderId, index) => ({
          tenantId: ctx.tenantId,
          batchId: batch!.id,
          position: from + index + 1,
          saleOrderId,
        })),
      );
    // With the batch, so a batch that commits is a batch the feeder is told about.
    await deps.jobs.enqueue(tx, 'bulk.feed', {});
    return { id: batch!.id, totalItems: orderIds.length };
  });
}

export type BatchCounts = Record<ItemView, number>;

const emptyCounts = (): BatchCounts => ({
  QUEUED: 0,
  CREATING: 0,
  SENT: 0,
  AUTHORIZED: 0,
  FAILED: 0,
});

// Counted from the items, with each invoice's status read from its document: the one place
// batches look at `documents`, so SRI's answer is never copied (ADR-026).
async function countsOf(tx: Tx, batchIds: string[]): Promise<Map<string, BatchCounts>> {
  const { bulkBatchItems: items, documents } = schema;
  const rows = await tx.db
    .select({
      batchId: items.batchId,
      status: items.status,
      document: documents.status,
      count: sql<number>`count(*)::int`,
    })
    .from(items)
    .leftJoin(
      documents,
      and(eq(documents.tenantId, items.tenantId), eq(documents.id, items.documentId)),
    )
    .where(inArray(items.batchId, batchIds))
    .groupBy(items.batchId, items.status, documents.status);
  const counts = new Map<string, BatchCounts>(batchIds.map((id) => [id, emptyCounts()]));
  for (const row of rows) counts.get(row.batchId)![itemView(row.status, row.document)] += row.count;
  return counts;
}

export type BatchRow = {
  id: string;
  source: 'SALE_ORDERS' | 'CSV';
  status: BatchStatus;
  totalItems: number;
  createdAt: Date;
  completedAt: Date | null;
  counts: BatchCounts;
};

const batchRow = (
  batch: typeof schema.bulkBatches.$inferSelect,
  counts: BatchCounts | undefined,
): BatchRow => ({
  id: batch.id,
  source: batch.source,
  status: batch.status,
  totalItems: batch.totalItems,
  createdAt: batch.createdAt,
  completedAt: batch.completedAt,
  counts: counts ?? emptyCounts(),
});

export async function listBatches(
  ctx: ActorContext,
  db: Database,
  page: { limit?: number; offset?: number } = {},
): Promise<{ rows: BatchRow[]; total: number }> {
  canRead(ctx);
  const limit = Math.min(page.limit ?? 25, 100);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const batches = await tx.db
      .select()
      .from(schema.bulkBatches)
      .orderBy(desc(schema.bulkBatches.createdAt), desc(schema.bulkBatches.id))
      .limit(limit)
      .offset(page.offset ?? 0);
    const [total] = await tx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.bulkBatches);
    const counts = batches.length
      ? await countsOf(
          tx,
          batches.map((batch) => batch.id),
        )
      : new Map<string, BatchCounts>();
    return {
      rows: batches.map((batch) => batchRow(batch, counts.get(batch.id))),
      total: total!.count,
    };
  });
}

export type BatchItemRow = {
  id: string;
  position: number;
  view: ItemView;
  saleOrderId: string | null;
  saleOrderNumber: number | null;
  documentId: string | null;
  documentNumber: string | null;
  documentStatus: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
};

// The stack view (FR-BULK-3): the batch, its counts and a page of its items in order.
export async function getBatch(
  ctx: ActorContext,
  db: Database,
  batchId: string,
  page: { limit?: number; offset?: number } = {},
): Promise<BatchRow & { items: BatchItemRow[] }> {
  canRead(ctx);
  const limit = Math.min(page.limit ?? 50, 200);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const [batch] = await tx.db
      .select()
      .from(schema.bulkBatches)
      .where(eq(schema.bulkBatches.id, batchId));
    if (!batch) throw new DomainError('NOT_FOUND', 'Batch not found');
    const counts = await countsOf(tx, [batch.id]);
    const { bulkBatchItems: items, documents, saleOrders } = schema;
    const rows = await tx.db
      .select({
        item: items,
        document: documents.status,
        series: documents.series,
        sequential: documents.sequential,
        orderNumber: saleOrders.number,
      })
      .from(items)
      .leftJoin(
        documents,
        and(eq(documents.tenantId, items.tenantId), eq(documents.id, items.documentId)),
      )
      .leftJoin(
        saleOrders,
        and(eq(saleOrders.tenantId, items.tenantId), eq(saleOrders.id, items.saleOrderId)),
      )
      .where(eq(items.batchId, batch.id))
      .orderBy(asc(items.position))
      .limit(limit)
      .offset(page.offset ?? 0);
    return {
      ...batchRow(batch, counts.get(batch.id)),
      items: rows.map(({ item, document, series, sequential, orderNumber }) => ({
        id: item.id,
        position: item.position,
        view: itemView(item.status, document),
        saleOrderId: item.saleOrderId,
        saleOrderNumber: orderNumber,
        documentId: item.documentId,
        documentNumber: series && sequential ? documentNumber(series, sequential) : null,
        documentStatus: document,
        attempts: item.attempts,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
      })),
    };
  });
}

// FR-BULK-3: failed items back to the queue (the quota was raised, a client fixed). An invoice
// SRI rejected isn't one of them: it is corrected and resent as the same row (FR-DOC-7).
export async function retryFailedItems(
  ctx: ActorContext,
  db: Database,
  batchId: string,
  deps: { jobs: Pick<Jobs, 'enqueue'> },
  itemIds: string[] | null = null,
): Promise<number> {
  requireFeature(ctx, 'BULK_INVOICING');
  requirePermission(ctx, 'documents.issue');
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const { bulkBatches: batches, bulkBatchItems: items } = schema;
    const [batch] = await tx.db.select().from(batches).where(eq(batches.id, batchId)).for('update');
    if (!batch) throw new DomainError('NOT_FOUND', 'Batch not found');
    const requeued = await tx.db
      .update(items)
      .set({ status: 'QUEUED', errorCode: null, errorMessage: null, dispatchedAt: null })
      .where(
        and(
          eq(items.batchId, batchId),
          eq(items.status, 'FAILED'),
          itemIds ? inArray(items.id, itemIds) : undefined,
        ),
      )
      .returning({ id: items.id });
    if (requeued.length === 0) return 0;
    if (batch.status === 'COMPLETED')
      await tx.db
        .update(batches)
        .set({ status: 'PROCESSING', completedAt: null })
        .where(eq(batches.id, batchId));
    await deps.jobs.enqueue(tx, 'bulk.feed', {});
    return requeued.length;
  });
}
