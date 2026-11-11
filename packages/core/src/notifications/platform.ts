import { randomUUID } from 'node:crypto';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  PLATFORM_NOTIFICATION_TYPES,
  schema,
  type Database,
  type PlatformNotificationType,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import type { EmailTemplate } from '../email';
import { assertSuperAdmin } from '../identity';
import type { Jobs } from '../jobs';
import type { PlatformActor } from '../kernel';
import { companyRow } from '../tenancy';
import type { NotificationParams, NotifyDeps } from './notify';

// FR-NOT-2 (ADR-036): what the platform's operators are told, outside any company. Every super
// admin gets the notice in the platform bell and by email; there is nothing to switch, since a
// payment waiting for the operator is the operator's work.
const SPECS: Record<PlatformNotificationType, { emailTemplate: EmailTemplate; link: string }> = {
  PAYMENT_REPORTED: { emailTemplate: 'paymentReported', link: '/admin/payments' },
  CARD_PAYMENT_APPLIED: { emailTemplate: 'cardPaymentApplied', link: '/admin/payments' },
};

export const operatorEventPayload = z.object({
  // The company the payment is of; its name is read when the operators are told.
  tenantId: z.uuid(),
  type: z.enum(PLATFORM_NOTIFICATION_TYPES),
  params: z.record(z.string(), z.string()).optional(),
  // A retry of the job tells no one twice.
  dedupeKey: z.string().optional(),
});
export type OperatorEvent = z.input<typeof operatorEventPayload>;

// For a caller in a company's transaction, which can't write platform tables: queued in that
// transaction (rule 10) and told by `platform.notify` in system context.
export function announceOperators(
  jobs: Pick<Jobs, 'enqueue'>,
  tx: Tx,
  event: Omit<OperatorEvent, 'dedupeKey'>,
): Promise<unknown> {
  return jobs.enqueue(tx, 'platform.notify', { ...event, dedupeKey: randomUUID() });
}

// In system context: a notice and a receipt for every super admin, and their email. A second call
// with the same key tells no one. Returns how many super admins were told.
export async function tellOperators(
  tx: Tx,
  deps: NotifyDeps,
  event: OperatorEvent,
): Promise<number> {
  const input = operatorEventPayload.parse(event);
  const spec = SPECS[input.type];
  const operators = await tx.db
    .select({ id: schema.users.id, email: schema.users.email, locale: schema.users.locale })
    .from(schema.users)
    .where(eq(schema.users.isSuperAdmin, true))
    .orderBy(schema.users.email);
  if (operators.length === 0) return 0;
  const [tenant] = await tx.db
    .select({ id: schema.tenants.id, twinOf: schema.tenants.twinOf })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, input.tenantId));
  if (!tenant) return 0;
  const company = await companyRow(tx.db, tenant.twinOf ?? tenant.id);
  const params: NotificationParams = { ...input.params, name: company.name };
  const [notification] = await tx.db
    .insert(schema.platformNotifications)
    .values({
      type: input.type,
      params: params as Record<string, string>,
      link: spec.link,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.platformNotifications.id });
  if (!notification) return 0;
  await tx.db
    .insert(schema.platformNotificationReceipts)
    .values(
      operators.map((operator) => ({ notificationId: notification.id, userId: operator.id })),
    );
  for (const operator of operators) {
    const locale = operator.locale === 'en' ? 'en' : 'es';
    await deps.jobs.enqueue(tx, 'email.send', {
      to: operator.email,
      locale,
      template: spec.emailTemplate,
      params: {
        url: `${deps.appUrl}/${locale}${spec.link}`,
        organization: company.name,
        ...(params.amount ? { amount: `$${params.amount}` } : {}),
      },
    });
  }
  return operators.length;
}

export async function deliverOperatorEvent(
  deps: { db: Database; notice: NotifyDeps },
  raw: OperatorEvent,
): Promise<void> {
  const event = operatorEventPayload.parse(raw);
  await deps.db.withSystem('tell the operators about an event', (tx) =>
    tellOperators(tx, deps.notice, event),
  );
}

// What a super admin reads of their own notices: the same shape as a company member's.
export type PlatformNotificationView = {
  id: string;
  type: PlatformNotificationType;
  params: Record<string, string>;
  link: string;
  createdAt: Date;
  readAt: Date | null;
};

export const PLATFORM_PAGE_SIZE = 20;

const columns = {
  id: schema.platformNotificationReceipts.id,
  type: schema.platformNotifications.type,
  params: schema.platformNotifications.params,
  link: schema.platformNotifications.link,
  createdAt: schema.platformNotifications.createdAt,
  readAt: schema.platformNotificationReceipts.readAt,
};

const receiptsOf = (tx: Tx['db'], userId: string) =>
  tx
    .select(columns)
    .from(schema.platformNotificationReceipts)
    .innerJoin(
      schema.platformNotifications,
      eq(schema.platformNotifications.id, schema.platformNotificationReceipts.notificationId),
    )
    .where(eq(schema.platformNotificationReceipts.userId, userId));

export async function listPlatformNotifications(
  actor: PlatformActor,
  db: Database,
  options: { unreadOnly?: boolean; page?: number } = {},
): Promise<{ items: PlatformNotificationView[]; hasMore: boolean }> {
  await assertSuperAdmin(db.identity, actor);
  const page = Math.max(options.page ?? 1, 1);
  return db.withSystem('super admin: read own notices', async ({ db: tx }) => {
    const rows = await tx
      .select(columns)
      .from(schema.platformNotificationReceipts)
      .innerJoin(
        schema.platformNotifications,
        eq(schema.platformNotifications.id, schema.platformNotificationReceipts.notificationId),
      )
      .where(
        and(
          eq(schema.platformNotificationReceipts.userId, actor.userId),
          options.unreadOnly ? isNull(schema.platformNotificationReceipts.readAt) : undefined,
        ),
      )
      .orderBy(
        desc(schema.platformNotifications.createdAt),
        desc(schema.platformNotificationReceipts.id),
      )
      .limit(PLATFORM_PAGE_SIZE + 1)
      .offset((page - 1) * PLATFORM_PAGE_SIZE);
    return { items: rows.slice(0, PLATFORM_PAGE_SIZE), hasMore: rows.length > PLATFORM_PAGE_SIZE };
  });
}

// What the platform bell shows: how many are unread and the latest few.
export async function platformNotificationSummary(
  actor: PlatformActor,
  db: Database,
  latest = 8,
): Promise<{ unread: number; items: PlatformNotificationView[] }> {
  await assertSuperAdmin(db.identity, actor);
  return db.withSystem('super admin: read the bell', async ({ db: tx }) => {
    const [unread] = await tx
      .select({ n: count() })
      .from(schema.platformNotificationReceipts)
      .where(
        and(
          eq(schema.platformNotificationReceipts.userId, actor.userId),
          isNull(schema.platformNotificationReceipts.readAt),
        ),
      );
    const items = await receiptsOf(tx, actor.userId)
      .orderBy(
        desc(schema.platformNotifications.createdAt),
        desc(schema.platformNotificationReceipts.id),
      )
      .limit(latest);
    return { unread: unread!.n, items };
  });
}

const idsInput = z.array(z.uuid()).min(1).max(100);

// Only the caller's own receipts, whatever ids are sent.
export async function markPlatformRead(
  actor: PlatformActor,
  db: Database,
  ids: string[],
): Promise<void> {
  const receiptIds = idsInput.parse(ids);
  await assertSuperAdmin(db.identity, actor);
  await db.withSystem('super admin: mark own notices read', ({ db: tx }) =>
    tx
      .update(schema.platformNotificationReceipts)
      .set({ readAt: actor.clock.now() })
      .where(
        and(
          inArray(schema.platformNotificationReceipts.id, receiptIds),
          eq(schema.platformNotificationReceipts.userId, actor.userId),
          isNull(schema.platformNotificationReceipts.readAt),
        ),
      ),
  );
}

export async function markAllPlatformRead(actor: PlatformActor, db: Database): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  await db.withSystem('super admin: mark all own notices read', ({ db: tx }) =>
    tx
      .update(schema.platformNotificationReceipts)
      .set({ readAt: actor.clock.now() })
      .where(
        and(
          eq(schema.platformNotificationReceipts.userId, actor.userId),
          isNull(schema.platformNotificationReceipts.readAt),
        ),
      ),
  );
}
