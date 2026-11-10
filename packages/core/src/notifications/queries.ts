import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  schema,
  sql,
  type Database,
  type NotificationChannel,
  type NotificationType,
} from '@comprobify/db';
import { z } from 'zod';
import { DomainError, type ActorContext, type TenantMode } from '../kernel';
import { realTenantOf } from '../tenancy';
import { NOTIFICATIONS, type Catalogue } from './catalog';
import { channelsFor } from './notify';

// FR-NOT-1: what a member sees of their company's notifications. Every read and change is of the
// member's own receipts and choices; the company is the real one, whichever copy they work in.

async function own(ctx: ActorContext, db: Database) {
  if (!ctx.userId)
    throw new DomainError('FORBIDDEN', 'Notifications belong to a member', {
      permission: 'member',
    });
  return { userId: ctx.userId, tenantId: await realTenantOf(ctx, db) };
}

export type NotificationView = {
  // The member's receipt: what is marked read.
  id: string;
  type: NotificationType;
  params: Record<string, string>;
  link: string;
  environment: TenantMode;
  createdAt: Date;
  readAt: Date | null;
};

export const PAGE_SIZE = 20;

export async function listNotifications(
  ctx: ActorContext,
  db: Database,
  options: { unreadOnly?: boolean; page?: number; pageSize?: number } = {},
): Promise<{ items: NotificationView[]; hasMore: boolean }> {
  const { userId, tenantId } = await own(ctx, db);
  const size = Math.min(Math.max(options.pageSize ?? PAGE_SIZE, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  return db.withTenant({ tenantId }, async ({ db: tx }) => {
    const { notificationReceipts: receipts, notifications } = schema;
    const rows = await tx
      .select({
        id: receipts.id,
        type: notifications.type,
        params: notifications.params,
        link: notifications.link,
        environment: notifications.environment,
        createdAt: notifications.createdAt,
        readAt: receipts.readAt,
      })
      .from(receipts)
      .innerJoin(
        notifications,
        and(
          eq(notifications.tenantId, receipts.tenantId),
          eq(notifications.id, receipts.notificationId),
        ),
      )
      .where(
        and(eq(receipts.userId, userId), options.unreadOnly ? isNull(receipts.readAt) : undefined),
      )
      .orderBy(desc(notifications.createdAt), desc(receipts.id))
      .limit(size + 1)
      .offset((page - 1) * size);
    return { items: rows.slice(0, size), hasMore: rows.length > size };
  });
}

// What the bell shows: how many are unread and the latest few, in one read.
export async function notificationSummary(
  ctx: ActorContext,
  db: Database,
  latest = 8,
): Promise<{ unread: number; items: NotificationView[] }> {
  const { userId, tenantId } = await own(ctx, db);
  return db.withTenant({ tenantId }, async ({ db: tx }) => {
    const { notificationReceipts: receipts, notifications } = schema;
    const [unread] = await tx
      .select({ n: count() })
      .from(receipts)
      .where(and(eq(receipts.userId, userId), isNull(receipts.readAt)));
    const items = await tx
      .select({
        id: receipts.id,
        type: notifications.type,
        params: notifications.params,
        link: notifications.link,
        environment: notifications.environment,
        createdAt: notifications.createdAt,
        readAt: receipts.readAt,
      })
      .from(receipts)
      .innerJoin(
        notifications,
        and(
          eq(notifications.tenantId, receipts.tenantId),
          eq(notifications.id, receipts.notificationId),
        ),
      )
      .where(eq(receipts.userId, userId))
      .orderBy(desc(notifications.createdAt), desc(receipts.id))
      .limit(latest);
    return { unread: unread!.n, items };
  });
}

export async function unreadCount(ctx: ActorContext, db: Database): Promise<number> {
  const { userId, tenantId } = await own(ctx, db);
  return db.withTenant({ tenantId }, async ({ db: tx }) => {
    const [row] = await tx
      .select({ n: count() })
      .from(schema.notificationReceipts)
      .where(
        and(
          eq(schema.notificationReceipts.userId, userId),
          isNull(schema.notificationReceipts.readAt),
        ),
      );
    return row!.n;
  });
}

const idsInput = z.array(z.uuid()).min(1).max(100);

export async function markRead(ctx: ActorContext, db: Database, ids: string[]): Promise<void> {
  const receiptIds = idsInput.parse(ids);
  const { userId, tenantId } = await own(ctx, db);
  await db.withTenant({ tenantId }, ({ db: tx }) =>
    tx
      .update(schema.notificationReceipts)
      .set({ readAt: ctx.clock.now() })
      .where(
        and(
          inArray(schema.notificationReceipts.id, receiptIds),
          eq(schema.notificationReceipts.userId, userId),
          isNull(schema.notificationReceipts.readAt),
        ),
      ),
  );
}

export async function markAllRead(ctx: ActorContext, db: Database): Promise<void> {
  const { userId, tenantId } = await own(ctx, db);
  await db.withTenant({ tenantId }, ({ db: tx }) =>
    tx
      .update(schema.notificationReceipts)
      .set({ readAt: ctx.clock.now() })
      .where(
        and(
          eq(schema.notificationReceipts.userId, userId),
          isNull(schema.notificationReceipts.readAt),
        ),
      ),
  );
}

export type PreferenceRow = {
  type: NotificationType;
  mandatory: boolean;
  channels: { channel: NotificationChannel; enabled: boolean; locked: boolean }[];
};

// What the member may switch: the types their role receives, each channel on or off. A mandatory
// type's channels show on and locked.
export async function notificationPreferences(
  ctx: ActorContext,
  db: Database,
  catalogue: Catalogue = NOTIFICATIONS,
): Promise<PreferenceRow[]> {
  const { userId, tenantId } = await own(ctx, db);
  const chosen = await db.withTenant({ tenantId }, ({ db: tx }) =>
    tx
      .select({
        type: schema.notificationPreferences.type,
        channel: schema.notificationPreferences.channel,
        enabled: schema.notificationPreferences.enabled,
      })
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId)),
  );
  return NOTIFICATION_TYPES.filter((type) =>
    ctx.permissions.includes(catalogue[type].audience),
  ).map((type) => {
    const spec = catalogue[type];
    const on = channelsFor(
      type,
      chosen.filter((row) => row.type === type),
      catalogue,
    );
    return {
      type,
      mandatory: spec.mandatory,
      channels: spec.channels.map((channel) => ({
        channel,
        enabled: on.includes(channel),
        locked: spec.mandatory,
      })),
    };
  });
}

export const preferenceInput = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});

export async function setNotificationPreference(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof preferenceInput>,
  catalogue: Catalogue = NOTIFICATIONS,
): Promise<void> {
  const input = preferenceInput.parse(raw);
  const { userId, tenantId } = await own(ctx, db);
  const spec = catalogue[input.type];
  // A type the member's role doesn't receive isn't theirs to switch.
  if (!ctx.permissions.includes(spec.audience))
    throw new DomainError('NOTIFICATION_NOT_AVAILABLE', 'This notification is not for your role');
  if (spec.mandatory)
    throw new DomainError('NOTIFICATION_MANDATORY', 'This notification can not be turned off');
  if (!spec.channels.includes(input.channel))
    throw new DomainError(
      'NOTIFICATION_CHANNEL_UNAVAILABLE',
      'This notification has no such channel',
    );
  await db.withTenant({ tenantId }, ({ db: tx }) =>
    tx
      .insert(schema.notificationPreferences)
      .values({
        tenantId,
        userId,
        type: input.type,
        channel: input.channel,
        enabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: [
          schema.notificationPreferences.tenantId,
          schema.notificationPreferences.userId,
          schema.notificationPreferences.type,
          schema.notificationPreferences.channel,
        ],
        set: { enabled: input.enabled, updatedAt: sql`now()` },
      }),
  );
}
