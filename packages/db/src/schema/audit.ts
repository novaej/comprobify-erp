import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './checks';
import { users } from './identity';
import { tenants } from './tenancy';

// FR-NOT-4: the single source for event names; the CHECK and core both use it. Two categories
// share the one table (ADR-041): ACCOUNT is who the company is and who can do what (sign-ins,
// people, settings, certificates, plan and payments); OPERATIONS is what the business did with
// money, stock and its records. The category is derived from the list an action sits in, so it
// can't drift from it.
export const ACCOUNT_AUDIT_ACTIONS = [
  'organization.created',
  'organization.went_live',
  // The test copy emptied and refilled from the company (PRD glossary, ADR-043).
  'organization.twin_reset',
  'organization.two_factor_requirement_changed',
  'organization.settings_changed',
  'branch.created',
  'branch.updated',
  'issue_point.created',
  'issue_point.document_types_changed',
  'issue_point.paused_changed',
  'sequence.starting_set',
  'certificate.uploaded',
  'member.invited',
  'member.invitation_revoked',
  'member.joined',
  'member.role_changed',
  'member.removed',
  // The owner handed the company to another member and became an admin (ADR-044).
  'member.ownership_transferred',
  'member.issue_points_changed',
  'agreements.accepted',
  'session.started',
  // The super admin's changes to what a company has (ADR-011).
  'subscription.plan_changed',
  'subscription.billing_changed',
  'subscription.price_changed',
  'subscription.module_added',
  'subscription.module_removed',
  'subscription.limit_set',
  'subscription.limit_cleared',
  'entitlements.override_set',
  'entitlements.override_cleared',
  // FR-BILL-2, FR-BILL-3 (ADR-029).
  'payment.created',
  'payment.reported',
  'payment.cancelled',
  'payment.verified',
  'payment.rejected',
  'payment.refunded',
  // FR-BILL-5 (ADR-030): the company's own changes to its subscription.
  'subscription.change_scheduled',
  'subscription.cancelled',
  'subscription.resumed',
  // FR-BILL-9: the operator's suspension, mirrored in the twin.
  'organization.suspended',
  'organization.reactivated',
  // FR-BILL-5 (ADR-032): the daily job's steps through the renewal cycle, each emailed.
  'subscription.renewal_due',
  'subscription.grace_started',
  'subscription.past_due',
  'subscription.moved_to_free',
  // FR-BILL-3 (ADR-033): a card charge captured but not applied, for the operator to refund.
  'payment.card_duplicate',
  // FR-BILL-4, FR-ADM-2: the operator's invoice for a payment, and a card charge settled by hand.
  'payment.invoiced',
  'payment.invoice_waived',
  'payment.card_resolved',
  // ADR-034: an unpaid payment charged again at a new IVA rate.
  'payment.repriced',
  // ADR-035: Personalizado billed, and an add-on given without charge.
  'subscription.custom_billing_started',
  'subscription.moved_to_custom',
  'subscription.module_complimentary',
] as const;

// What the business did: voids, stock, master data, collections, orders, batches, data taken out.
export const OPERATIONS_AUDIT_ACTIONS = [
  'document.voided',
  'stock.adjusted',
  'stock.opening_set',
  'stock.opening_imported',
  'product.created',
  'product.updated',
  'product.active_changed',
  'product.imported',
  'client.created',
  'client.updated',
  'client.active_changed',
  'client.imported',
  'provider.created',
  'provider.updated',
  'provider.active_changed',
  'purchase_order.cancelled',
  'sale_order.cancelled',
  'sale_order.invoiced',
  'receivable.payment_recorded',
  'receivable.payment_voided',
  'bulk.batch_started',
  'data.exported',
] as const;

export const AUDIT_ACTIONS = [...ACCOUNT_AUDIT_ACTIONS, ...OPERATIONS_AUDIT_ACTIONS] as const;

export const AUDIT_CATEGORIES = ['ACCOUNT', 'OPERATIONS'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const auditCategoryOf = (action: (typeof AUDIT_ACTIONS)[number]): AuditCategory =>
  (OPERATIONS_AUDIT_ACTIONS as readonly string[]).includes(action) ? 'OPERATIONS' : 'ACCOUNT';

// Append-only: the app role may insert and read, never update or delete.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    // Null for the system, such as a scheduled job.
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action', { enum: AUDIT_ACTIONS }).notNull(),
    // What it was done to, when that is a user (a member) or another row.
    subjectUserId: uuid('subject_user_id').references(() => users.id),
    // Allow-listed fields per action; never secrets, tokens or certificate keys.
    details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('audit_events_action_check', oneOf('action', AUDIT_ACTIONS)),
    index('audit_events_tenant_time_idx').on(table.tenantId, table.occurredAt),
    // One "session started" per session and tenant, however many pages it opens.
    uniqueIndex('audit_events_session_started_idx')
      .on(table.tenantId, sql`(${table.details}->>'sessionId')`)
      .where(sql`${table.action} = 'session.started'`),
  ],
);

// The super admin's changes to the platform catalog, which reach every tenant on a plan.
// No tenant_id: it is platform data, written in system context and never updated.
export const PLATFORM_AUDIT_ACTIONS = [
  'module.created',
  'module.updated',
  'module.feature_added',
  'module.feature_removed',
  'plan.created',
  'plan.updated',
  'plan.module_added',
  'plan.module_removed',
  'plan.limit_changed',
  // FR-BILL-6: prices (ADR-027).
  'price.drafted',
  'price.published',
  'price.discarded',
  // FR-BILL-2: the IVA on subscriptions (ADR-034).
  'iva.scheduled',
  'iva.withdrawn',
  // FR-DOC-13: the operator read a document's exchanges with SRI, for support.
  'document.exchanges_viewed',
  // FR-ADM-5: a failed job put back in the queue by the operator.
  'job.retried',
  // FR-NOT-3 (ADR-037): the emails the platform writes.
  'email_template.drafted',
  'email_template.published',
  'email_template.discarded',
  'email_template.test_sent',
] as const;

export const platformAuditEvents = pgTable(
  'platform_audit_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    action: text('action', { enum: PLATFORM_AUDIT_ACTIONS }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('platform_audit_events_action_check', oneOf('action', PLATFORM_AUDIT_ACTIONS)),
    index('platform_audit_events_occurred_idx').on(table.occurredAt),
  ],
);
