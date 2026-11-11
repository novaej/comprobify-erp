import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './checks';
import { users } from './identity';
import { TENANT_MODES } from './tenancy';

// FR-NOT-1, FR-NOT-2 (ADR-036). The names of what can be notified: the CHECK below and core's
// catalogue (channels, defaults, audience) both come from this list, and core's catalogue is
// typed over it, so a type can't exist in one place only (rule 17).
export const NOTIFICATION_TYPES = [
  // The renewal cycle (ADR-032) and what changes an open payment's total (ADR-034, ADR-035).
  'RENEWAL_DUE',
  'GRACE_STARTED',
  'PAST_DUE',
  'MOVED_TO_FREE',
  'PAYMENT_REPRICED',
  'RENEWAL_REPRICED',
  // The operator's decision on a transfer, and a card payment applied (FR-BILL-3).
  'PAYMENT_VERIFIED',
  'PAYMENT_REJECTED',
  // What happened to a document at SRI, and to a batch of them (FR-DOC-4 to FR-DOC-6, FR-BULK-3).
  'DOCUMENT_REJECTED',
  'DOCUMENT_SEND_FAILED',
  'DOCUMENT_OVERDUE',
  'DOCUMENT_REISSUED',
  'DOCUMENTS_AUTHORIZED',
  'BATCH_COMPLETED',
  // The signing certificate running out, and the document quota filling up (FR-NOT-2).
  'CERTIFICATE_EXPIRING',
  'CERTIFICATE_EXPIRED',
  'QUOTA_NEARING',
  'QUOTA_REACHED',
  // What the platform changes under a company, with notice (FR-BILL-6, ADR-011).
  'PRICE_RISE',
  'PLAN_CONTENT_LEAVING',
  'PLAN_LIMIT_LOWERING',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

// One event in a company. Text is not stored: it is rendered when shown, from the type and its
// parameters, in the viewer's language. Written in the real company, also for what happened in
// its test copy, which `environment` says.
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    // Plain strings that fill the message: an amount, an ISO date, a reason code, a name.
    params: jsonb('params').$type<Record<string, string>>().default({}).notNull(),
    // Where it leads, without the language prefix, such as /plan.
    link: text('link').notNull(),
    environment: text('environment', { enum: TENANT_MODES }).notNull(),
    // What the event is about, so a retried job tells the company once (NFR-JOB-1).
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('notifications_tenant_id_unique').on(table.tenantId, table.id),
    uniqueIndex('notifications_dedupe_unique')
      .on(table.tenantId, table.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
    check('notifications_type_check', oneOf('type', NOTIFICATION_TYPES)),
    check('notifications_environment_check', oneOf('environment', TENANT_MODES)),
  ],
);

// Who sees it in the app, and whether they have read it. A member with the in-app channel off
// for the type gets no receipt.
export const notificationReceipts = pgTable(
  'notification_receipts',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    notificationId: uuid('notification_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'notification_receipts_notification_fk',
      columns: [table.tenantId, table.notificationId],
      foreignColumns: [notifications.tenantId, notifications.id],
    }),
    unique('notification_receipts_one_per_user').on(table.notificationId, table.userId),
    index('notification_receipts_user_recent').on(table.tenantId, table.userId, table.createdAt),
    index('notification_receipts_user_unread')
      .on(table.tenantId, table.userId)
      .where(sql`read_at IS NULL`),
  ],
);

// What a member chose, per company, type and channel. Only choices are stored, so a new type's
// defaults reach everyone who never touched it.
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    channel: text('channel', { enum: NOTIFICATION_CHANNELS }).notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('notification_preferences_one_per_choice').on(
      table.tenantId,
      table.userId,
      table.type,
      table.channel,
    ),
    check('notification_preferences_type_check', oneOf('type', NOTIFICATION_TYPES)),
    check('notification_preferences_channel_check', oneOf('channel', NOTIFICATION_CHANNELS)),
  ],
);
