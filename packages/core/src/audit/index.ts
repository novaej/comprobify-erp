import {
  ACCOUNT_AUDIT_ACTIONS,
  AUDIT_ACTIONS,
  auditCategoryOf,
  OPERATIONS_AUDIT_ACTIONS,
  and,
  desc,
  eq,
  inArray,
  or,
  PLATFORM_AUDIT_ACTIONS,
  schema,
  sql,
  type AuditCategory,
  type Database,
  type Tx,
} from '@comprobify/db';
import { DomainError, type ActorContext } from '../kernel';

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export { AUDIT_ACTIONS, auditCategoryOf };
export type { AuditCategory };

// A field's change on a record: what it was, what it is (values as text; nothing personal).
export type AuditChanges = Record<string, [string | null, string | null]>;

// What changed between two versions of a record, field by field, as text; nothing when no
// listed field differs. For records whose values are not personal (a product's price, its tax).
export function auditChanges<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): AuditChanges | null {
  // Values are text, numbers or booleans here; an object has no place in a change.
  const text = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : null;
  const changes: AuditChanges = {};
  for (const field of fields)
    if (text(before[field]) !== text(after[field]))
      changes[field] = [text(before[field]), text(after[field])];
  return Object.keys(changes).length > 0 ? changes : null;
}

// Which fields of a record changed, by name only: for records that hold other people's data
// (a client's email, a provider's address), where the log says that it changed, not to what.
export function auditFieldsChanged<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): string[] {
  return fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

export type AuditEvent = {
  tenantId: string;
  actorUserId: string | null;
  action: AuditAction;
  subjectUserId?: string | null;
  // Allow-listed by each caller: never secrets, tokens or certificate keys.
  details?: Record<string, string | number | boolean | null | string[] | AuditChanges>;
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

// Who took data out, and what (ADR-041): a CSV of master data or stock, a report, the accountant's
// ZIP. The download itself is a web route; this is what it records. `what` is a short stable key.
export async function recordDataExport(
  ctx: ActorContext,
  db: Database,
  what: string,
): Promise<void> {
  await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    recordAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId ?? null,
      action: 'data.exported',
      details: { export: what },
    }),
  );
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
  category: AuditCategory;
  occurredAt: Date;
  actorName: string | null;
  subjectName: string | null;
  details: Record<string, unknown>;
};

// Which categories of the log a person may read: ACCOUNT with `audit.read`, OPERATIONS with
// `audit.operations.read` (ADR-041).
function readableCategories(ctx: ActorContext): AuditCategory[] {
  return [
    ...(ctx.permissions.includes('audit.read') ? (['ACCOUNT'] as const) : []),
    ...(ctx.permissions.includes('audit.operations.read') ? (['OPERATIONS'] as const) : []),
  ];
}

// The company's log, newest first, of one category or of every one the person may read. Changes to
// the company itself (settings, agreements, plan: ACCOUNT) are recorded on the real company, so
// the test copy shows its own and the company's; what the business did (OPERATIONS) is the
// company in use only, so testing never mixes with the real books.
export async function listAuditEvents(
  ctx: ActorContext,
  db: Database,
  options: { limit?: number; category?: AuditCategory } = {},
): Promise<AuditEntry[]> {
  const allowed = readableCategories(ctx);
  const wanted = options.category ? [options.category] : allowed;
  if (allowed.length === 0 || wanted.some((category) => !allowed.includes(category)))
    throw new DomainError('FORBIDDEN', 'Not allowed to read this part of the activity log');
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
      const withCompany = self?.twinOf ? [ctx.tenantId, self.twinOf] : [ctx.tenantId];
      // The account half also counts the company's own tenant; the operations half does not.
      const scope = wanted.map((category) =>
        category === 'ACCOUNT'
          ? and(
              inArray(auditEvents.tenantId, withCompany),
              inArray(auditEvents.action, [...ACCOUNT_AUDIT_ACTIONS]),
            )
          : and(
              eq(auditEvents.tenantId, ctx.tenantId),
              inArray(auditEvents.action, [...OPERATIONS_AUDIT_ACTIONS]),
            ),
      );
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
        .where(or(...scope))
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
                inArray(schema.memberships.tenantId, withCompany),
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
      category: auditCategoryOf(row.action),
      occurredAt: row.occurredAt,
      actorName: row.actorName,
      subjectName: row.subjectName,
      details: row.details,
    }))
    .slice(0, limit);
}
