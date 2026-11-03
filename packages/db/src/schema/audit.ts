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
  'certificate.uploaded',
  'member.invited',
  'member.invitation_revoked',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'member.issue_points_changed',
  'agreements.accepted',
  'session.started',
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
