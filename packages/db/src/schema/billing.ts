import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf, transitionTriggerBody } from './checks';
import { BILLING_INTERVALS, modules, plans, subscriptions } from './entitlements';
import { users } from './identity';

// FR-BILL-6 (ADR-027): what is sold and for how much, with its history. A plan, an add-on
// module and an extra seat cost a monthly amount (yearly is 10 times it, FR-BILL-1); a
// document pack costs its amount once.
export const PRICE_KINDS = ['PLAN', 'MODULE', 'SEAT', 'PACK'] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

// A draft is the super admin's work in progress; publishing dates it and it never changes
// again. A draft that isn't wanted is discarded, never deleted (rule 12).
export const PRICE_STATUSES = ['DRAFT', 'PUBLISHED', 'DISCARDED'] as const;
export type PriceStatus = (typeof PRICE_STATUSES)[number];
export const PRICE_TRANSITIONS: Record<PriceStatus, readonly PriceStatus[]> = {
  DRAFT: ['PUBLISHED', 'DISCARDED'],
  PUBLISHED: [],
  DISCARDED: [],
};

// Platform data, like the plans it prices: no tenant, written in system context only.
export const prices = pgTable(
  'prices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text('kind', { enum: PRICE_KINDS }).notNull(),
    planId: uuid('plan_id').references(() => plans.id),
    moduleId: uuid('module_id').references(() => modules.id),
    // A pack's size in documents; the size is what is sold.
    packSize: integer('pack_size'),
    // Before IVA. Null only for a pack no longer sold from `effective_on`.
    amount: numeric('amount', { precision: 12, scale: 2 }),
    status: text('status', { enum: PRICE_STATUSES }).default('DRAFT').notNull(),
    // The Ecuador date it applies from; set when published.
    effectiveOn: date('effective_on'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('prices_kind_check', oneOf('kind', PRICE_KINDS)),
    check('prices_status_check', oneOf('status', PRICE_STATUSES)),
    check(
      'prices_shape_check',
      sql`CASE kind
            WHEN 'PLAN' THEN plan_id IS NOT NULL AND module_id IS NULL AND pack_size IS NULL
            WHEN 'MODULE' THEN module_id IS NOT NULL AND plan_id IS NULL AND pack_size IS NULL
            WHEN 'SEAT' THEN plan_id IS NULL AND module_id IS NULL AND pack_size IS NULL
            WHEN 'PACK' THEN pack_size > 0 AND plan_id IS NULL AND module_id IS NULL
          END`,
    ),
    check('prices_amount_check', sql`amount IS NULL OR amount >= 0`),
    check('prices_withdrawn_check', sql`amount IS NOT NULL OR kind = 'PACK'`),
    check(
      'prices_published_check',
      sql`(status = 'PUBLISHED') = (effective_on IS NOT NULL AND published_at IS NOT NULL)`,
    ),
    // One draft per thing sold, and one published price per thing and date.
    uniqueIndex('prices_one_draft')
      .on(
        table.kind,
        sql`coalesce(plan_id, module_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(pack_size, 0)`,
      )
      .where(sql`status = 'DRAFT'`),
    uniqueIndex('prices_one_per_day')
      .on(
        table.kind,
        sql`coalesce(plan_id, module_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(pack_size, 0)`,
        table.effectiveOn,
      )
      .where(sql`status = 'PUBLISHED'`),
    index('prices_lookup').on(table.kind, table.planId, table.moduleId, table.effectiveOn),
  ],
);

// The trigger that enforces PRICE_TRANSITIONS; migration 0049 holds its output.
export const priceStatusTriggerBody = (): string =>
  transitionTriggerBody('Price', PRICE_STATUSES, PRICE_TRANSITIONS);

// FR-BILL-2 (ADR-029): what a payment is for. Each purpose changes the subscription its own way
// once the payment is verified.
export const PAYMENT_PURPOSES = [
  'INITIAL',
  'RENEWAL',
  'TIER_CHANGE',
  'SEAT_CHANGE',
  'DOCUMENT_PACK',
  // An add-on module the company buys on top of its plan (ADR-030).
  'ADD_ON',
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

// FR-BILL-3: a bank transfer with proof, or a card through Payphone (step 6).
export const PAYMENT_METHODS = ['SPI_TRANSFER', 'PAYPHONE_CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// PENDING is owed (the PRD's PENDING_PAYMENT); REPORTED waits for the operator. A rejected one can
// be reported again or cancelled; a verified one can only be refunded.
export const PAYMENT_STATUSES = [
  'PENDING',
  'REPORTED',
  'VERIFIED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  // A card charge verifies a payment that was never reported (step 6).
  PENDING: ['REPORTED', 'VERIFIED', 'CANCELLED'],
  REPORTED: ['VERIFIED', 'REJECTED'],
  REJECTED: ['REPORTED', 'VERIFIED', 'CANCELLED'],
  VERIFIED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

// Why the operator rejected a transfer: stable codes the company reads in its own language.
export const PAYMENT_REJECTION_REASONS = [
  'AMOUNT_MISMATCH',
  'TRANSFER_NOT_FOUND',
  'WRONG_ACCOUNT',
  'ILLEGIBLE_PROOF',
  'DUPLICATE_SUBMISSION',
  'OTHER',
] as const;
export type PaymentRejectionReason = (typeof PAYMENT_REJECTION_REASONS)[number];

const amount = (name: string) => numeric(name, { precision: 12, scale: 2 });

// One charge to the company, in the real company only: the twin never pays (FR-ONB-6a). Amounts
// are the base before IVA, the IVA at the rate of the day it was created, and their total.
export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').notNull(),
    subscriptionId: uuid('subscription_id').notNull(),
    // Short and typed by hand into a bank transfer's description: CB-XXXXXXXX.
    code: text('code').notNull().unique(),
    purpose: text('purpose', { enum: PAYMENT_PURPOSES }).notNull(),
    status: text('status', { enum: PAYMENT_STATUSES }).default('PENDING').notNull(),
    method: text('method', { enum: PAYMENT_METHODS }),
    baseAmount: amount('base_amount').notNull(),
    ivaRate: numeric('iva_rate', { precision: 5, scale: 2 }).notNull(),
    ivaAmount: amount('iva_amount').notNull(),
    totalAmount: amount('total_amount').notNull(),
    // What it buys: the plan and interval it moves to, extra seats, a pack's documents.
    targetPlanId: uuid('target_plan_id').references(() => plans.id),
    targetInterval: text('target_interval', { enum: BILLING_INTERVALS }),
    targetSeats: integer('target_seats'),
    targetModuleId: uuid('target_module_id').references(() => modules.id),
    packSize: integer('pack_size'),
    // How the amount was reached, for a prorated or composite charge.
    pricing: jsonb('pricing').$type<Record<string, unknown>>().default({}).notNull(),
    // The period it paid for, once applied: the subscription's own dates move on every renewal.
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    // The subscription as it was just before this payment changed it: a refund restores it.
    appliedFrom: jsonb('applied_from').$type<Record<string, unknown>>(),
    rejectionReason: text('rejection_reason', { enum: PAYMENT_REJECTION_REASONS }),
    refundReason: text('refund_reason'),
    // The operator's own invoice for it, issued from Comprobify (FR-BILL-4): a work queue. The
    // document is the operator's company's, so no foreign key reaches across.
    invoiceDocumentId: uuid('invoice_document_id'),
    invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundedBy: uuid('refunded_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'payments_subscription_fk',
      columns: [table.tenantId, table.subscriptionId],
      foreignColumns: [subscriptions.tenantId, subscriptions.id],
    }),
    unique('payments_tenant_id_unique').on(table.tenantId, table.id),
    index('payments_tenant_status').on(table.tenantId, table.status),
    index('payments_status').on(table.status, table.reportedAt),
    check('payments_purpose_check', oneOf('purpose', PAYMENT_PURPOSES)),
    check('payments_status_check', oneOf('status', PAYMENT_STATUSES)),
    check('payments_method_check', sql`method IS NULL OR ${oneOf('method', PAYMENT_METHODS)}`),
    check(
      'payments_rejection_check',
      sql`rejection_reason IS NULL OR ${oneOf('rejection_reason', PAYMENT_REJECTION_REASONS)}`,
    ),
    check('payments_code_check', sql`code ~ '^CB-[2-9A-HJ-NP-Z]{8}$'`),
    check(
      'payments_amounts_check',
      sql`base_amount >= 0 AND iva_amount >= 0 AND iva_rate >= 0 AND total_amount = base_amount + iva_amount`,
    ),
    check(
      'payments_target_check',
      sql`CASE purpose
            WHEN 'INITIAL' THEN target_plan_id IS NOT NULL AND target_interval IS NOT NULL
            WHEN 'TIER_CHANGE' THEN target_plan_id IS NOT NULL AND target_interval IS NOT NULL
            WHEN 'SEAT_CHANGE' THEN target_seats IS NOT NULL AND target_seats >= 0
            WHEN 'DOCUMENT_PACK' THEN pack_size > 0
            WHEN 'ADD_ON' THEN target_module_id IS NOT NULL
            ELSE true
          END`,
    ),
    check(
      'payments_verified_check',
      sql`(status IN ('VERIFIED', 'REFUNDED')) = (verified_at IS NOT NULL)`,
    ),
    check('payments_refunded_check', sql`(status = 'REFUNDED') = (refunded_at IS NOT NULL)`),
    // A rejection keeps its reason when the payment is later cancelled.
    check('payments_rejected_check', sql`status <> 'REJECTED' OR rejection_reason IS NOT NULL`),
    check('payments_period_check', sql`period_end IS NULL OR period_end > period_start`),
  ],
);

// The trigger that enforces PAYMENT_TRANSITIONS; migration 0051 holds its output.
export const paymentStatusTriggerBody = (): string =>
  transitionTriggerBody('Payment', PAYMENT_STATUSES, PAYMENT_TRANSITIONS);

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// FR-BILL-3: what the company sent as proof of a transfer. Never overwritten: a company removes a
// file (it stops showing to it), and the operator still sees every one.
export const paymentProofs = pgTable(
  'payment_proofs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    content: bytea('content').notNull(),
    size: integer('size').notNull(),
    // The bank's reference for the transfer, given with each submission.
    reference: text('reference').notNull(),
    active: boolean('active').default(true).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'payment_proofs_payment_fk',
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    index('payment_proofs_payment').on(table.tenantId, table.paymentId),
    check(
      'payment_proofs_type_check',
      sql`content_type IN ('image/png', 'image/jpeg', 'image/gif', 'application/pdf')`,
    ),
    check('payment_proofs_size_check', sql`size > 0 AND size <= 2097152`),
    check('payment_proofs_removed_check', sql`active = (removed_at IS NULL)`),
  ],
);

// FR-BILL-7: a pack is bought once and spent after the period's quota, oldest first. It rolls over
// from period to period until used; only an untouched pack is refunded.
export const PACK_STATUSES = ['ACTIVE', 'REFUNDED'] as const;
export type PackStatus = (typeof PACK_STATUSES)[number];
export const PACK_TRANSITIONS: Record<PackStatus, readonly PackStatus[]> = {
  ACTIVE: ['REFUNDED'],
  REFUNDED: [],
};

// In the real company only: the twin never uses quota (FR-ONB-6a).
export const documentPacks = pgTable(
  'document_packs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    size: integer('size').notNull(),
    used: integer('used').default(0).notNull(),
    status: text('status', { enum: PACK_STATUSES }).default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'document_packs_payment_fk',
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    unique('document_packs_payment_unique').on(table.paymentId),
    index('document_packs_tenant_open').on(table.tenantId, table.status, table.createdAt),
    check('document_packs_status_check', oneOf('status', PACK_STATUSES)),
    check('document_packs_used_check', sql`size > 0 AND used >= 0 AND used <= size`),
    check('document_packs_refunded_check', sql`status = 'ACTIVE' OR used = 0`),
  ],
);

// The trigger that enforces PACK_TRANSITIONS; migration 0053 holds its output.
export const packStatusTriggerBody = (): string =>
  transitionTriggerBody('Pack', PACK_STATUSES, PACK_TRANSITIONS);

// FR-BILL-3 (ADR-033): one Payphone card attempt, never reused. PENDING is the only state whose
// outcome is unknown; every other one is final. DUPLICATE is captured money that was not applied
// (the payment was already paid or cancelled): the operator refunds it by hand.
export const CARD_ATTEMPT_STATUSES = [
  'PENDING',
  'APPROVED',
  'CANCELLED',
  'EXPIRED',
  'DUPLICATE',
  'ERROR',
] as const;
export type CardAttemptStatus = (typeof CARD_ATTEMPT_STATUSES)[number];
export const CARD_ATTEMPT_TRANSITIONS: Record<CardAttemptStatus, readonly CardAttemptStatus[]> = {
  PENDING: ['APPROVED', 'CANCELLED', 'EXPIRED', 'DUPLICATE', 'ERROR'],
  // Approved, then found to be a second charge when applied.
  APPROVED: ['DUPLICATE'],
  CANCELLED: [],
  EXPIRED: [],
  DUPLICATE: [],
  ERROR: [],
};

export const payphoneTransactions = pgTable(
  'payphone_transactions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    // Ours, sent to Payphone and echoed on the return redirect: short, opaque, one per attempt.
    clientTransactionId: text('client_transaction_id').notNull().unique(),
    // Payphone's, known from the return redirect. Kept even when nothing else could be saved: a
    // charge it captured can only be looked up again by it.
    payphoneTransactionId: bigint('payphone_transaction_id', { mode: 'number' }),
    status: text('status', { enum: CARD_ATTEMPT_STATUSES }).default('PENDING').notNull(),
    // Integer cents, as Payphone takes them; a confirmed amount must match it.
    amountCents: integer('amount_cents').notNull(),
    statusCode: integer('status_code'),
    // Vendor display data with no length promise, so text.
    authorizationCode: text('authorization_code'),
    cardBrand: text('card_brand'),
    cardLastDigits: text('card_last_digits'),
    // Payphone's answer, allow-listed: the payer's email, phone and id are dropped.
    confirmResponse: jsonb('confirm_response').$type<Record<string, unknown>>(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    // The second phase: the payment applied. APPROVED without it is swept and finished.
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'payphone_transactions_payment_fk',
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    index('payphone_transactions_payment').on(table.tenantId, table.paymentId),
    index('payphone_transactions_pending')
      .on(table.createdAt)
      .where(sql`status = 'PENDING'`),
    index('payphone_transactions_unapplied')
      .on(table.confirmedAt)
      .where(sql`status = 'APPROVED' AND applied_at IS NULL`),
    check('payphone_transactions_status_check', oneOf('status', CARD_ATTEMPT_STATUSES)),
    check('payphone_transactions_amount_check', sql`amount_cents >= 100`),
  ],
);

// The trigger that enforces CARD_ATTEMPT_TRANSITIONS; migration 0055 holds its output.
export const cardAttemptStatusTriggerBody = (): string =>
  transitionTriggerBody('Card attempt', CARD_ATTEMPT_STATUSES, CARD_ATTEMPT_TRANSITIONS);
