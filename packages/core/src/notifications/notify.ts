import {
  and,
  eq,
  inArray,
  schema,
  type NotificationChannel,
  type NotificationType,
  type Tx,
} from '@comprobify/db';
import type { Jobs } from '../jobs';
import type { TenantMode } from '../kernel';
import { companyRow, permissionsFor } from '../tenancy';
import { NOTIFICATIONS, type Catalogue } from './catalog';

// What `notify` needs from the deployment: the queue, in the caller's transaction, and the
// address emails link back to.
export type NotifyDeps = { jobs: Pick<Jobs, 'enqueue'>; appUrl: string };

// Plain strings that fill a message. `date` is an ISO date; `amount` is before any currency sign.
export type NotificationParams = Partial<
  Record<'date' | 'amount' | 'rate' | 'reason' | 'code', string>
>;

const formatDate = (date: string, locale: 'es' | 'en') =>
  new Intl.DateTimeFormat(locale === 'es' ? 'es-EC' : 'en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

// Which channels a member has for a type: all of a mandatory one's, else what they chose, else
// the type's defaults.
export function channelsFor(
  type: NotificationType,
  choices: { channel: NotificationChannel; enabled: boolean }[],
  catalogue: Catalogue = NOTIFICATIONS,
): NotificationChannel[] {
  const spec = catalogue[type];
  if (spec.mandatory) return [...spec.channels];
  return spec.channels.filter((channel) => {
    const chosen = choices.find((choice) => choice.channel === channel);
    return chosen ? chosen.enabled : spec.defaults.includes(channel);
  });
}

// FR-NOT-1 (ADR-036): tell the members of a company who can act on it, in the caller's
// transaction (rule 10). The in-app channel is a receipt each member reads; the email channel is
// an `email.send` job in the member's language. Returns how many members were told anywhere.
export async function notify(
  tx: Tx,
  deps: NotifyDeps,
  input: {
    // The real company: notifications live there, also for its test copy.
    tenantId: string;
    type: NotificationType;
    params?: NotificationParams;
    environment?: TenantMode;
  },
  catalogue: Catalogue = NOTIFICATIONS,
): Promise<number> {
  const spec = catalogue[input.type];
  const { memberships, users, notificationPreferences } = schema;
  const members = await tx.db
    .select({
      userId: users.id,
      email: users.email,
      locale: users.locale,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.active, true)))
    .orderBy(users.email);
  const audience = members.filter((member) => permissionsFor(member.role).includes(spec.audience));
  if (audience.length === 0) return 0;
  const choices = await tx.db
    .select({
      userId: notificationPreferences.userId,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.tenantId, input.tenantId),
        eq(notificationPreferences.type, input.type),
        inArray(
          notificationPreferences.userId,
          audience.map((member) => member.userId),
        ),
      ),
    );
  const told = audience.map((member) => ({
    member,
    channels: channelsFor(
      input.type,
      choices.filter((choice) => choice.userId === member.userId),
      catalogue,
    ),
  }));

  const inApp = told.filter((row) => row.channels.includes('IN_APP'));
  if (inApp.length > 0) {
    const [notification] = await tx.db
      .insert(schema.notifications)
      .values({
        tenantId: input.tenantId,
        type: input.type,
        params: { ...input.params } as Record<string, string>,
        link: spec.link,
        environment: input.environment ?? 'PRODUCTION',
      })
      .returning({ id: schema.notifications.id });
    await tx.db.insert(schema.notificationReceipts).values(
      inApp.map((row) => ({
        tenantId: input.tenantId,
        notificationId: notification!.id,
        userId: row.member.userId,
      })),
    );
  }

  const emailed = told.filter((row) => row.channels.includes('EMAIL') && spec.emailTemplate);
  if (emailed.length > 0) {
    const company = await companyRow(tx.db, input.tenantId);
    for (const { member } of emailed) {
      const locale = member.locale === 'en' ? 'en' : 'es';
      await deps.jobs.enqueue(tx, 'email.send', {
        to: member.email,
        locale,
        template: spec.emailTemplate!,
        params: {
          url: `${deps.appUrl}/${locale}${spec.link}`,
          organization: company.name,
          ...(input.params?.date ? { date: formatDate(input.params.date, locale) } : {}),
          ...(input.params?.amount ? { amount: `$${input.params.amount}` } : {}),
          ...(input.params?.rate ? { rate: `${Number(input.params.rate)} %` } : {}),
          ...(input.params?.reason ? { reason: input.params.reason } : {}),
        },
      });
    }
  }
  return told.filter((row) => row.channels.length > 0).length;
}
