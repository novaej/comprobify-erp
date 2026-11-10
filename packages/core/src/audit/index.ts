import {
  AUDIT_ACTIONS,
  desc,
  eq,
  PLATFORM_AUDIT_ACTIONS,
  schema,
  sql,
  type Database,
  type Tx,
} from '@comprobify/db';
import { requirePermission, type ActorContext } from '../kernel';

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export { AUDIT_ACTIONS };

export type AuditEvent = {
  tenantId: string;
  actorUserId: string | null;
  action: AuditAction;
  subjectUserId?: string | null;
  // Allow-listed by each caller: never secrets, tokens or certificate keys.
  details?: Record<string, string | number | boolean | null | string[]>;
};

// FR-NOT-4. Written in the same transaction as the change, so a rolled-back
// change leaves no event and a committed one always has its event.
export async function recordAudit(tx: Tx['db'], event: AuditEvent): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    tenantId: event.tenantId,
    actorUserId: event.actorUserId,
    action: event.action,
    subjectUserId: event.subjectUserId ?? null,
    details: event.details ?? {},
  });
}

// The company's latest event of this kind with these details, or null: what makes a notice
// sent once, and remembers when a step was taken (the daily billing job, ADR-032).
export async function findAuditEvent(
  tx: Tx['db'],
  tenantId: string,
  action: AuditAction,
  details: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const [row] = await tx
    .select({ details: schema.auditEvents.details })
    .from(schema.auditEvents)
    .where(
      sql`${schema.auditEvents.tenantId} = ${tenantId} AND ${schema.auditEvents.action} = ${action}
          AND ${schema.auditEvents.details} @> ${JSON.stringify(details)}::jsonb`,
    )
    .orderBy(desc(schema.auditEvents.occurredAt))
    .limit(1);
  return row?.details ?? null;
}

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

// The platform's own log: catalog changes that reach every company on a plan (ADR-011).
// Same transaction as the change, like recordAudit.
export async function recordPlatformAudit(
  tx: Tx['db'],
  event: {
    actorUserId: string;
    action: PlatformAuditAction;
    details?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await tx.insert(schema.platformAuditEvents).values({
    actorUserId: event.actorUserId,
    action: event.action,
    details: event.details ?? {},
  });
}

// "Logins" in FR-NOT-4, recorded in the company a session opens, once per session.
export async function recordSessionStart(
  db: Database,
  input: { tenantId: string; userId: string; sessionId: string },
): Promise<void> {
  await db.withTenant({ tenantId: input.tenantId }, ({ db: tx }) =>
    tx
      .insert(schema.auditEvents)
      .values({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        action: 'session.started',
        details: { sessionId: input.sessionId },
      })
      .onConflictDoNothing(),
  );
}

export type AuditEntry = {
  id: string;
  action: AuditAction;
  occurredAt: Date;
  actorName: string | null;
  subjectName: string | null;
  details: Record<string, unknown>;
};

// The company's log, newest first.
export async function listAuditEvents(
  ctx: ActorContext,
  db: Database,
  options: { limit?: number } = {},
): Promise<AuditEntry[]> {
  requirePermission(ctx, 'audit.read');
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  return db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) => {
    const { auditEvents, users } = schema;
    return tx
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        occurredAt: auditEvents.occurredAt,
        actorName: users.name,
        subjectName: sql<
          string | null
        >`(SELECT u.name FROM ${users} u WHERE u.id = ${auditEvents.subjectUserId})`,
        details: auditEvents.details,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(limit);
  });
}
