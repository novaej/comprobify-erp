import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  date,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './checks';
import { users } from './identity';
import { clients, products, type AdditionalDetail } from './master-data';
import {
  SRI_DOCUMENT_TYPES,
  SRI_ID_TYPES,
  SRI_IVA_RATE_CODES,
  SRI_PAYMENT_METHODS,
  SRI_TERM_UNITS,
} from './sri';
import { issuePoints, tenants } from './tenancy';

// FR-DOC-3. The one definition of the status machine: the CHECK below, the trigger in the
// migrations (documentStatusTriggerBody) and core's assertTransition all come from it.
export const DOCUMENT_STATUSES = [
  'SIGNED',
  'PENDING_SEND',
  'RECEIVED',
  'RETURNED',
  'SEND_FAILED',
  'AUTHORIZED',
  'NOT_AUTHORIZED',
  'VOIDED',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  SIGNED: ['PENDING_SEND'],
  PENDING_SEND: ['RECEIVED', 'RETURNED', 'SEND_FAILED'],
  // A re-check finds SRI has it, or the next try is queued (FR-DOC-4, FR-DOC-6).
  SEND_FAILED: ['RECEIVED', 'PENDING_SEND', 'SIGNED'],
  RECEIVED: ['AUTHORIZED', 'NOT_AUTHORIZED'],
  // Corrected and resent as the same row and sequential (FR-DOC-7).
  RETURNED: ['SIGNED'],
  NOT_AUTHORIZED: ['SIGNED'],
  AUTHORIZED: ['VOIDED'],
  VOIDED: [],
};

// What a document's timeline records (FR-DOC-13).
export const DOCUMENT_EVENT_TYPES = [
  'CREATED',
  'STATUS_CHANGED',
  'SRI_RESPONSE',
  'CORRECTED',
  'REISSUED',
  'VOIDED',
  'EMAILED',
] as const;

export const AMBIENTES = ['1', '2'] as const;

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();
const amount = (name: string) => numeric(name, { precision: 14, scale: 2 });
const precise = (name: string) => numeric(name, { precision: 18, scale: 6 });

// One electronic document. The buyer and totals are a snapshot: the document never
// changes because a client or product does (SRI rule 15).
export const documents = pgTable(
  'documents',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    issuePointId: uuid('issue_point_id').notNull(),
    documentType: text('document_type', { enum: SRI_DOCUMENT_TYPES }).notNull(),
    // estab + ptoEmi, as the access key and the number print them.
    series: text('series').notNull(),
    sequential: integer('sequential').notNull(),
    ambiente: text('ambiente', { enum: AMBIENTES }).notNull(),
    // Changes only on correction or re-issue, which go back to SIGNED (FR-DOC-6, FR-DOC-7).
    accessKey: text('access_key').notNull(),
    issueDate: date('issue_date').notNull(),
    status: text('status', { enum: DOCUMENT_STATUSES }).default('SIGNED').notNull(),
    // The line set in force; a correction adds a new one (rows are never deleted).
    revision: integer('revision').default(1).notNull(),
    clientId: uuid('client_id'),
    buyerIdType: text('buyer_id_type', { enum: SRI_ID_TYPES }).notNull(),
    buyerIdentification: text('buyer_identification').notNull(),
    buyerName: text('buyer_name').notNull(),
    buyerAddress: text('buyer_address'),
    buyerEmail: text('buyer_email'),
    subtotal: amount('subtotal').notNull(),
    discount: amount('discount').notNull(),
    // totalConImpuestos, as built (ADR-012).
    taxTotals: jsonb('tax_totals')
      .$type<
        { taxCode: string; rateCode: string; percent: string; base: string; value: string }[]
      >()
      .notNull(),
    total: amount('total').notNull(),
    signedXml: text('signed_xml'),
    // Set once, from SRI's answer.
    authorizationNumber: text('authorization_number'),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    authorizationXml: text('authorization_xml'),
    // The sending calendar (FR-DOC-4, FR-DOC-5); operational, so the triggers leave them free.
    // Retries stop at the end of the issue day, Ecuador time.
    retryUntil: timestamp('retry_until', { withTimezone: true }),
    sendAttempts: integer('send_attempts').default(0).notNull(),
    // Set by the read-only check after the deadline; `sriUnreachable` when SRI couldn't be asked.
    deadlineCheckedAt: timestamp('deadline_checked_at', { withTimezone: true }),
    sriUnreachable: boolean('sri_unreachable').default(false).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    authorizationChecks: integer('authorization_checks').default(0).notNull(),
    // FR-DOC-5: no final answer 24 hours after RECEIVED.
    overdueAlertedAt: timestamp('overdue_alerted_at', { withTimezone: true }),
    // FR-DOC-2: the same key and payload give the same document; another payload, a conflict.
    idempotencyKey: text('idempotency_key'),
    payloadHash: text('payload_hash'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'documents_issue_point_fk',
      columns: [table.tenantId, table.issuePointId],
      foreignColumns: [issuePoints.tenantId, issuePoints.id],
    }),
    foreignKey({
      name: 'documents_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
    // SRI rule 5: no duplicate sequentials or keys.
    unique('documents_sequential_unique').on(
      table.issuePointId,
      table.documentType,
      table.sequential,
    ),
    unique('documents_access_key_unique').on(table.accessKey),
    unique('documents_tenant_id_unique').on(table.tenantId, table.id),
    uniqueIndex('documents_idempotency_key')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    index('documents_tenant_status_idx').on(table.tenantId, table.status),
    // The overdue sweep reads across tenants.
    index('documents_received_idx')
      .on(table.receivedAt)
      .where(sql`status = 'RECEIVED' AND overdue_alerted_at IS NULL`),
    check('documents_type_check', oneOf('document_type', SRI_DOCUMENT_TYPES)),
    check('documents_status_check', oneOf('status', DOCUMENT_STATUSES)),
    check('documents_ambiente_check', oneOf('ambiente', AMBIENTES)),
    check('documents_buyer_id_type_check', oneOf('buyer_id_type', SRI_ID_TYPES)),
    check('documents_series_check', sql`series ~ '^[0-9]{6}$'`),
    check('documents_sequential_check', sql`sequential BETWEEN 1 AND 999999999`),
    check('documents_access_key_check', sql`access_key ~ '^[0-9]{49}$'`),
    check('documents_amounts_check', sql`subtotal >= 0 AND discount >= 0 AND total >= 0`),
  ],
);

export const documentLines = pgTable(
  'document_lines',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    documentId: uuid('document_id').notNull(),
    revision: integer('revision').notNull(),
    position: integer('position').notNull(),
    productId: uuid('product_id'),
    code: text('code').notNull(),
    auxiliaryCode: text('auxiliary_code'),
    name: text('name').notNull(),
    unit: text('unit'),
    quantity: precise('quantity').notNull(),
    unitPrice: precise('unit_price').notNull(),
    discount: amount('discount').notNull(),
    ivaRateCode: text('iva_rate_code').notNull(),
    ivaPercent: numeric('iva_percent', { precision: 5, scale: 2 }).notNull(),
    base: amount('base').notNull(),
    iva: amount('iva').notNull(),
    additionalDetails: jsonb('additional_details')
      .$type<AdditionalDetail[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'document_lines_document_fk',
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    foreignKey({
      name: 'document_lines_product_fk',
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    unique('document_lines_position_unique').on(table.documentId, table.revision, table.position),
    check('document_lines_iva_rate_check', oneOf('iva_rate_code', SRI_IVA_RATE_CODES)),
    check(
      'document_lines_amounts_check',
      sql`quantity > 0 AND unit_price >= 0 AND discount >= 0 AND base >= 0 AND iva >= 0`,
    ),
  ],
);

// pagos in the XML.
export const documentPayments = pgTable(
  'document_payments',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    documentId: uuid('document_id').notNull(),
    revision: integer('revision').notNull(),
    position: integer('position').notNull(),
    method: text('method', { enum: SRI_PAYMENT_METHODS }).notNull(),
    amount: amount('amount').notNull(),
    term: integer('term'),
    termUnit: text('term_unit', { enum: SRI_TERM_UNITS }),
  },
  (table) => [
    foreignKey({
      name: 'document_payments_document_fk',
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    unique('document_payments_position_unique').on(
      table.documentId,
      table.revision,
      table.position,
    ),
    check('document_payments_method_check', oneOf('method', SRI_PAYMENT_METHODS)),
    check('document_payments_term_unit_check', oneOf('term_unit', SRI_TERM_UNITS)),
    check('document_payments_amount_check', sql`amount > 0`),
  ],
);

// FR-DOC-13: the timeline, append-only. SRI's raw answers are kept here, never shown.
export const documentEvents = pgTable(
  'document_events',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    documentId: uuid('document_id').notNull(),
    type: text('type', { enum: DOCUMENT_EVENT_TYPES }).notNull(),
    fromStatus: text('from_status', { enum: DOCUMENT_STATUSES }),
    toStatus: text('to_status', { enum: DOCUMENT_STATUSES }),
    details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
    sriResponse: text('sri_response'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'document_events_document_fk',
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    index('document_events_document_idx').on(table.documentId, table.occurredAt),
    check('document_events_type_check', oneOf('type', DOCUMENT_EVENT_TYPES)),
    check('document_events_from_check', oneOf('from_status', DOCUMENT_STATUSES)),
    check('document_events_to_check', oneOf('to_status', DOCUMENT_STATUSES)),
  ],
);

// The trigger that enforces DOCUMENT_TRANSITIONS in the database, generated from it so the
// two can't drift (rule 17). A migration holds its output; a test compares the live one.
export function documentStatusTriggerBody(): string {
  const cases = DOCUMENT_STATUSES.map((from) => {
    const allowed = DOCUMENT_TRANSITIONS[from];
    // A terminal status allows nothing: `IN (NULL)` would be NULL, which lets it through.
    const test =
      allowed.length > 0 ? `NEW.status IN (${allowed.map((to) => `'${to}'`).join(', ')})` : 'false';
    return `    WHEN '${from}' THEN ${test}`;
  }).join('\n');
  return `IF NEW.status IS DISTINCT FROM OLD.status AND NOT (CASE OLD.status
${cases}
    ELSE false
  END) THEN
    RAISE EXCEPTION 'Document status % can not become %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;`;
}
