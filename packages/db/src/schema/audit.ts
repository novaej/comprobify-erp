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

// FR-NOT-4: the single source for event names; the CHECK and core both use it.
export const AUDIT_ACTIONS = [
  'organization.created',
  'organization.went_live',
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
] as const;

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
