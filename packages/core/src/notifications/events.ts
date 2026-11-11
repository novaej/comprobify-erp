import { randomUUID } from 'node:crypto';
import { and, eq, NOTIFICATION_TYPES, schema, sql, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import type { Jobs } from '../jobs';
import { notify, type NotificationParams, type NotifyDeps } from './notify';

// FR-NOT-2 (ADR-036): events that happen where no company's actor is at hand (SRI's answers, a
// sweep) are told by a job, queued in the transaction that caused them (rule 10). The job finds
// the real company, which also holds a test copy's notices, and tells its members.
export const notificationEventPayload = z.object({
  // The tenant the event happened in: a company or its test copy.
  tenantId: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  params: z.record(z.string(), z.string()).optional(),
  // Where it leads, without the language prefix.
  link: z.string().startsWith('/').optional(),
  // A retry of the job tells no one twice. Authorizations are grouped instead.
  dedupeKey: z.string().optional(),
});
export type NotificationEvent = z.input<typeof notificationEventPayload>;

// Types told as one notice per window, with a running `count`.
const GROUPED: readonly NotificationEvent['type'][] = ['DOCUMENTS_AUTHORIZED'];

export function announce(
  jobs: Pick<Jobs, 'enqueue'>,
  tx: Tx,
  event: Omit<NotificationEvent, 'dedupeKey'>,
): Promise<unknown> {
  return jobs.enqueue(tx, 'notifications.send', {
    ...event,
    ...(GROUPED.includes(event.type) ? {} : { dedupeKey: randomUUID() }),
  });
}

export type EventDeps = { db: Database; notice: NotifyDeps };

export async function deliverNotificationEvent(
  deps: EventDeps,
  raw: NotificationEvent,
): Promise<void> {
  const event = notificationEventPayload.parse(raw);
  await deps.db.withSystem('tell a company about an event', async (tx) => {
    const [tenant] = await tx.db
      .select({ id: schema.tenants.id, twinOf: schema.tenants.twinOf, mode: schema.tenants.mode })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, event.tenantId));
    if (!tenant) return;
    const input = {
      tenantId: tenant.twinOf ?? tenant.id,
      type: event.type,
      params: event.params as NotificationParams | undefined,
      environment: tenant.mode,
      ...(event.link ? { link: event.link } : {}),
      ...(event.dedupeKey ? { dedupeKey: event.dedupeKey } : {}),
    };
    if (GROUPED.includes(event.type)) await notifyGrouped(tx, deps, input);
    else await notify(tx, deps.notice, input);
  });
}

// One notice per company and window: another event inside it adds to the count. A lock per
// company and type keeps two jobs at once from opening two notices.
async function notifyGrouped(
  tx: Tx,
  deps: EventDeps,
  input: Parameters<typeof notify>[2] & { type: NotificationEvent['type'] },
): Promise<void> {
  const { notifications } = schema;
  await tx.db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.type}`}, 0))`,
  );
  const grown = await tx.db
    .update(notifications)
    .set({
      params: sql`jsonb_set(${notifications.params}, '{count}', to_jsonb(((${notifications.params}->>'count')::int + 1)::text))`,
    })
    .where(
      and(
        eq(notifications.tenantId, input.tenantId),
        eq(notifications.type, input.type),
        eq(notifications.environment, input.environment ?? 'PRODUCTION'),
        sql`${notifications.createdAt} > now() - interval '60 seconds'`,
      ),
    )
    .returning({ id: notifications.id });
  if (grown.length > 0) return;
  await notify(tx, deps.notice, { ...input, params: { count: '1' } });
}
