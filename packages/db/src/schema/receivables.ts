import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { documents } from './documents';
import { oneOf } from './checks';
import { users } from './identity';
import { SRI_PAYMENT_METHODS } from './sri';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

// FR-SAL-10: money received for an authorized invoice, recorded by hand. A payment is never
// edited or deleted: a mistake is voided with a reason, and the balance ignores voided ones.
export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    documentId: uuid('document_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    paidOn: date('paid_on').notNull(),
    // How it was paid, in SRI's table (formaPago), as the invoice states its payments.
    method: text('method', { enum: SRI_PAYMENT_METHODS }).notNull(),
    reference: text('reference'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidReason: text('void_reason'),
  },
  (table) => [
    foreignKey({
      name: 'invoice_payments_document_fk',
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    index('invoice_payments_document').on(table.tenantId, table.documentId),
    check('invoice_payments_amount_check', sql`amount > 0`),
    check('invoice_payments_method_check', oneOf('method', SRI_PAYMENT_METHODS)),
    check('invoice_payments_void_check', sql`(voided_at IS NULL) = (void_reason IS NULL)`),
  ],
);
