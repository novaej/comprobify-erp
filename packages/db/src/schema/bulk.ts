import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf, transitionTriggerBody } from './checks';
import { documents } from './documents';
import { users } from './identity';
import { saleOrders } from './sales';
import { SRI_PAYMENT_METHODS, SRI_TERM_UNITS } from './sri';
import { issuePoints } from './tenancy';

// FR-BULK-1, FR-BULK-2 (ADR-026). A batch is open while any item can still change.
export const BATCH_STATUSES = ['PROCESSING', 'COMPLETED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
// Retrying failed items reopens a finished batch.
export const BATCH_TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  PROCESSING: ['COMPLETED'],
  COMPLETED: ['PROCESSING'],
};

export const BATCH_SOURCES = ['SALE_ORDERS', 'CSV'] as const;
export type BatchSource = (typeof BATCH_SOURCES)[number];

// What the batch itself did with an item. Once the invoice exists, SRI's answer is the
// document's status, which the stack view reads from the document instead of keeping a copy.
export const BATCH_ITEM_STATUSES = ['QUEUED', 'CREATING', 'CREATED', 'FAILED'] as const;
export type BatchItemStatus = (typeof BATCH_ITEM_STATUSES)[number];
export const BATCH_ITEM_TRANSITIONS: Record<BatchItemStatus, readonly BatchItemStatus[]> = {
  QUEUED: ['CREATING'],
  CREATING: ['CREATED', 'FAILED'],
  CREATED: [],
  FAILED: ['QUEUED'],
};

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

// Many invoices asked for at once, from one issue point. The counts are read from the items,
// so there is no counter to drift.
export const bulkBatches = pgTable(
  'bulk_batches',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    source: text('source', { enum: BATCH_SOURCES }).notNull(),
    status: text('status', { enum: BATCH_STATUSES }).default('PROCESSING').notNull(),
    issuePointId: uuid('issue_point_id').notNull(),
    // How the invoices of a sale-order batch are paid: one payment for the whole total.
    paymentMethod: text('payment_method', { enum: SRI_PAYMENT_METHODS }),
    paymentTerm: integer('payment_term'),
    paymentTermUnit: text('payment_term_unit', { enum: SRI_TERM_UNITS }),
    totalItems: integer('total_items').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'bulk_batches_issue_point_fk',
      columns: [table.tenantId, table.issuePointId],
      foreignColumns: [issuePoints.tenantId, issuePoints.id],
    }),
    unique('bulk_batches_tenant_id_unique').on(table.tenantId, table.id),
    index('bulk_batches_tenant').on(table.tenantId, table.createdAt),
    check('bulk_batches_status_check', oneOf('status', BATCH_STATUSES)),
    check('bulk_batches_source_check', oneOf('source', BATCH_SOURCES)),
    check('bulk_batches_total_check', sql`total_items > 0`),
    check('bulk_batches_completed_check', sql`(status = 'COMPLETED') = (completed_at IS NOT NULL)`),
  ],
);

// One invoice to make. A sale-order item names its order; a CSV item holds its validated row.
// A failure keeps its code and reason; a retry clears them and counts an attempt.
export const bulkBatchItems = pgTable(
  'bulk_batch_items',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    position: integer('position').notNull(),
    status: text('status', { enum: BATCH_ITEM_STATUSES }).default('QUEUED').notNull(),
    saleOrderId: uuid('sale_order_id'),
    input: jsonb('input'),
    documentId: uuid('document_id'),
    // When the feeder put the item's job on the queue (ADR-026). Null: waiting for a turn.
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    attempts: integer('attempts').default(0).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'bulk_batch_items_batch_fk',
      columns: [table.tenantId, table.batchId],
      foreignColumns: [bulkBatches.tenantId, bulkBatches.id],
    }),
    foreignKey({
      name: 'bulk_batch_items_order_fk',
      columns: [table.tenantId, table.saleOrderId],
      foreignColumns: [saleOrders.tenantId, saleOrders.id],
    }),
    foreignKey({
      name: 'bulk_batch_items_document_fk',
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    unique('bulk_batch_items_position_unique').on(table.batchId, table.position),
    index('bulk_batch_items_batch').on(table.tenantId, table.batchId, table.status),
    // What the feeder scans across companies (ADR-026): only the unfinished work.
    index('bulk_batch_items_pending')
      .on(table.tenantId, table.status)
      .where(sql`status IN ('QUEUED', 'CREATING')`),
    index('bulk_batch_items_waiting')
      .on(table.tenantId, table.batchId, table.position)
      .where(sql`status = 'QUEUED' AND dispatched_at IS NULL`),
    check('bulk_batch_items_status_check', oneOf('status', BATCH_ITEM_STATUSES)),
    check('bulk_batch_items_position_check', sql`position > 0 AND attempts >= 0`),
    // An item names an order or carries a row, never both.
    check('bulk_batch_items_source_check', sql`(sale_order_id IS NULL) <> (input IS NULL)`),
    check(
      'bulk_batch_items_outcome_check',
      sql`(status = 'CREATED') = (document_id IS NOT NULL) AND (status = 'FAILED') = (error_code IS NOT NULL)`,
    ),
  ],
);

// The triggers that enforce the two machines; migration 0047 holds their output.
export const batchStatusTriggerBody = (): string =>
  transitionTriggerBody('Batch', BATCH_STATUSES, BATCH_TRANSITIONS);
export const batchItemStatusTriggerBody = (): string =>
  transitionTriggerBody('Batch item', BATCH_ITEM_STATUSES, BATCH_ITEM_TRANSITIONS);
