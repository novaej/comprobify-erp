import { desc, eq, schema, sql, type Database } from '@comprobify/db';
import { z } from 'zod';
import { assertSuperAdmin } from '../identity';
import type { PlatformActor } from '../kernel';

// The platform's own log (FR-ADM-1, ADR-011): what the super admins changed that reaches every
// company: plans, modules, prices, the IVA, the email texts and failed jobs put back. Read in
// system context; the table is never updated.
export const ACTIVITY_PAGE_SIZE = 25;

// The first part of an action's name, which groups them for a filter.
export const ACTIVITY_GROUPS = [
  'module',
  'plan',
  'price',
  'iva',
  'email_template',
  'job',
  'document',
] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export type PlatformActivity = {
  id: string;
  occurredAt: Date;
  action: string;
  details: Record<string, unknown>;
  // Who did it, by the name and address on their account.
  actorName: string;
  actorEmail: string;
};

export const activityInput = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  group: z.enum(ACTIVITY_GROUPS).optional(),
});
export type ActivityInput = z.input<typeof activityInput>;

export async function platformActivity(
  actor: PlatformActor,
  db: Database,
  raw: ActivityInput = {},
): Promise<{ rows: PlatformActivity[]; hasMore: boolean }> {
  await assertSuperAdmin(db.identity, actor);
  const input = activityInput.parse(raw);
  const { platformAuditEvents: events, users } = schema;
  const rows = await db.withSystem('super admin: read the platform log', ({ db: tx }) =>
    tx
      .select({
        id: events.id,
        occurredAt: events.occurredAt,
        action: events.action,
        details: events.details,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(events)
      .innerJoin(users, eq(users.id, events.actorUserId))
      .where(input.group ? sql`starts_with(${events.action}, ${`${input.group}.`})` : undefined)
      .orderBy(desc(events.occurredAt), desc(events.id))
      .limit(ACTIVITY_PAGE_SIZE + 1)
      .offset((input.page - 1) * ACTIVITY_PAGE_SIZE),
  );
  return { rows: rows.slice(0, ACTIVITY_PAGE_SIZE), hasMore: rows.length > ACTIVITY_PAGE_SIZE };
}

// How many entries a group has, for the filter's choices.
export async function activityCounts(
  actor: PlatformActor,
  db: Database,
): Promise<Record<ActivityGroup, number>> {
  await assertSuperAdmin(db.identity, actor);
  const rows = await db.withSystem('super admin: count the platform log', ({ db: tx }) =>
    tx
      .select({
        group: sql<string>`split_part(${schema.platformAuditEvents.action}, '.', 1)`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.platformAuditEvents)
      .groupBy(sql`split_part(${schema.platformAuditEvents.action}, '.', 1)`),
  );
  return Object.fromEntries(
    ACTIVITY_GROUPS.map((group) => [group, rows.find((row) => row.group === group)?.count ?? 0]),
  ) as Record<ActivityGroup, number>;
}
