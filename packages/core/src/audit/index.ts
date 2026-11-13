import {
  AUDIT_ACTIONS,
  and,
  desc,
  eq,
  inArray,
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

// The company's log, newest first. Changes to the company itself (settings, agreements, plan)
// are recorded on the real company, so the test copy shows its own events and the company's.
export async function listAuditEvents(
  ctx: ActorContext,
  db: Database,
  options: { limit?: number } = {},
): Promise<AuditEntry[]> {
  requirePermission(ctx, 'audit.read');
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  // System context, only to find the real company of a test copy: the ids it reads are the
  // actor's own company and its twin, never another's.
  const rows = await db.withSystem(
    'read the log of a company and its test copy',
    async ({ db: tx }) => {
      const { auditEvents, users, tenants } = schema;
      const [self] = await tx
        .select({ twinOf: tenants.twinOf })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));
      const ids = self?.twinOf ? [ctx.tenantId, self.twinOf] : [ctx.tenantId];
      const found = await tx
        .select({
          id: auditEvents.id,
          tenantId: auditEvents.tenantId,
          action: auditEvents.action,
          occurredAt: auditEvents.occurredAt,
          actorName: users.name,
          actorId: auditEvents.actorUserId,
          isOperator: users.isSuperAdmin,
          subjectName: sql<
            string | null
          >`(SELECT u.name FROM ${users} u WHERE u.id = ${auditEvents.subjectUserId})`,
          details: auditEvents.details,
        })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(inArray(auditEvents.tenantId, ids))
        .orderBy(desc(auditEvents.occurredAt))
        // Twice as many, as the pairs below collapse.
        .limit(limit * 2);
      // A super admin who works on the company (verifying a payment) is not one of its people:
      // the log says Comprobify, not their name, unless they also belong to this company.
      const operators = [
        ...new Set(found.filter((row) => row.isOperator && row.actorId).map((row) => row.actorId!)),
      ];
      const members = operators.length
        ? await tx
            .select({ userId: schema.memberships.userId })
            .from(schema.memberships)
            .where(
              and(
                inArray(schema.memberships.tenantId, ids),
                inArray(schema.memberships.userId, operators),
              ),
            )
        : [];
      const belongs = new Set(members.map((row) => row.userId));
      return found.map((row) =>
        row.isOperator && row.actorId && !belongs.has(row.actorId)
          ? { ...row, actorName: 'Comprobify' }
          : row,
      );
    },
  );
  // Some events are recorded on both the company and its test copy (creation, the certificate):
  // same moment and actor (their details may differ, such as the mode). Shown once.
  const seen = new Map<string, string>();
  return rows
    .filter((row) => {
      const key = [
        row.action,
        row.actorName,
        row.subjectName,
        // To the second: both rows come from one action.
        Math.floor(row.occurredAt.getTime() / 1000),
      ].join('|');
      const first = seen.get(key);
      // Only a twin of an event already listed from the other company; two of the same company
      // in one second are both real.
      if (first !== undefined && first !== row.tenantId) return false;
      seen.set(key, first ?? row.tenantId);
      return true;
    })
    .map((row) => ({
      id: row.id,
      action: row.action,
      occurredAt: row.occurredAt,
      actorName: row.actorName,
      subjectName: row.subjectName,
      details: row.details,
    }))
    .slice(0, limit);
}
