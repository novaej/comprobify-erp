import type { Logger } from '@comprobify/config/logger';
import { and, eq, schema, type Database } from '@comprobify/db';
import { invoiceOrderRemainder, type IssueDeps } from '../documents';
import { isDomainError, type Clock } from '../kernel';
import type { Jobs } from '../jobs';
import { resolveActor } from '../tenancy';
import { FINAL_DOCUMENT_STATUSES } from './status';

// FR-BULK-2 (ADR-026): the worker's side of a batch.

export type BulkDeps = {
  db: Database;
  jobs: Pick<Jobs, 'enqueue'>;
  clock: Clock;
  logger: Logger;
  issue: Omit<IssueDeps, 'jobs'>;
};

const MESSAGE_MAX = 500;

class BatchItemError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// One item, one invoice. The claim is its own short transaction so a person watching sees
// CREATING; the invoice and the item's CREATED commit together, so a crash between them leaves
// CREATING and no invoice, and the retried job finds the invoice by its key if there is one.
export async function processItem(
  deps: BulkDeps,
  job: { tenantId: string; itemId: string },
): Promise<void> {
  const { db, clock, logger } = deps;
  const { bulkBatchItems: items, bulkBatches: batches } = schema;
  const claimed = await db.withTenant({ tenantId: job.tenantId }, async (tx) => {
    const [item] = await tx.db.select().from(items).where(eq(items.id, job.itemId)).for('update');
    // Done, failed or gone: a repeat of the job has nothing to do.
    if (!item || (item.status !== 'QUEUED' && item.status !== 'CREATING')) return null;
    if (item.status === 'QUEUED')
      await tx.db
        .update(items)
        .set({ status: 'CREATING', attempts: item.attempts + 1 })
        .where(eq(items.id, item.id));
    const [batch] = await tx.db.select().from(batches).where(eq(batches.id, item.batchId));
    return { item, batch: batch! };
  });
  if (!claimed) return;
  const { item, batch } = claimed;

  try {
    // Who started the batch is who issues: their role and the plan are read now, not then.
    const ctx = await resolveActor(db, {
      userId: batch.createdBy!,
      tenantId: job.tenantId,
      clock,
    });
    await db.withTenant({ tenantId: job.tenantId }, async (tx) => {
      const [current] = await tx.db
        .select({ status: items.status })
        .from(items)
        .where(eq(items.id, item.id))
        .for('update');
      if (current?.status !== 'CREATING') return;
      if (!item.saleOrderId)
        throw new BatchItemError('BATCH_ITEM_INVALID', 'The item names no sale order');
      const issued = await invoiceOrderRemainder(
        ctx,
        tx,
        {
          orderId: item.saleOrderId,
          issuePointId: batch.issuePointId,
          payment: {
            method: batch.paymentMethod!,
            amount: null,
            term: batch.paymentTerm,
            termUnit: batch.paymentTermUnit,
          },
          idempotencyKey: item.id,
        },
        { ...deps.issue, jobs: deps.jobs },
      );
      await tx.db
        .update(items)
        .set({ status: 'CREATED', documentId: issued.id })
        .where(eq(items.id, item.id));
    });
  } catch (error) {
    // A refusal fails this item and nothing else (quota, an order no longer invoiceable, a
    // client without an email). Anything else is the platform's: the job is retried.
    const refusal =
      isDomainError(error) || error instanceof BatchItemError
        ? { code: error.code, message: error.message }
        : null;
    if (!refusal) throw error;
    await db.withTenant({ tenantId: job.tenantId }, (tx) =>
      tx.db
        .update(items)
        .set({
          status: 'FAILED',
          errorCode: refusal.code,
          errorMessage: refusal.message.slice(0, MESSAGE_MAX),
        })
        .where(and(eq(items.id, item.id), eq(items.status, 'CREATING'))),
    );
    logger.info(`Batch ${item.batchId}: item ${item.position} failed`, {
      event: 'bulk.item_failed',
      tenantId: job.tenantId,
      reason: refusal.code,
    });
  }
}

// A batch is done when nothing is queued or being made and every invoice has its final answer
// from SRI (FR-BULK-3). Marked here, on a schedule, so documents never need to know batches
// exist. The in-app notification comes with notifications (Milestone 9); today it is logged.
export async function completeBatches(
  deps: Pick<BulkDeps, 'db' | 'clock' | 'logger'>,
): Promise<number> {
  // Our own constants, never input.
  const final = FINAL_DOCUMENT_STATUSES.map((status) => `'${status}'`).join(', ');
  const completed = await deps.db.withSystem(
    'mark bulk batches whose invoices have all been answered',
    async ({ executeSql }) => {
      const { rows } = await executeSql<{ id: string; tenantId: string; total: number }>(
        `UPDATE bulk_batches b SET status = 'COMPLETED', completed_at = $1
         WHERE b.status = 'PROCESSING' AND NOT EXISTS (
           SELECT 1 FROM bulk_batch_items i
           LEFT JOIN documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
           WHERE i.batch_id = b.id AND (
             i.status IN ('QUEUED', 'CREATING')
             OR (i.status = 'CREATED' AND d.status NOT IN (${final}))))
         RETURNING b.id, b.tenant_id AS "tenantId", b.total_items AS total`,
        [deps.clock.now()],
      );
      return rows;
    },
  );
  for (const batch of completed)
    deps.logger.info(`Batch ${batch.id} completed: ${batch.total} items`, {
      event: 'bulk.batch_completed',
      tenantId: batch.tenantId,
    });
  return completed.length;
}
