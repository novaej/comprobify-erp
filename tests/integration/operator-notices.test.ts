import { randomUUID } from 'node:crypto';
import {
  createKeyCipher,
  deliverOperatorEvent,
  fixedClock,
  listPlatformNotifications,
  markAllPlatformRead,
  markPlatformRead,
  onboardOrganization,
  platformNotificationSummary,
  resolveActor,
  startPaidPlan,
  submitProof,
  type CreatedOrganization,
  type OperatorEvent,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

type Sent = { to: string; template: string; params: Record<string, string> };

// FR-NOT-2 (ADR-036): a transfer reported to the operator, told to every super admin in the
// platform bell and by email, once, whoever reads it first.
describe('operator notices', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let first: PlatformActor;
  let second: PlatformActor;
  let org: CreatedOrganization;
  let ownerId: string;
  const events: OperatorEvent[] = [];
  const sent: Sent[] = [];
  const notice = {
    appUrl: 'https://app.test',
    jobs: {
      enqueue: (_tx: unknown, queue: string, data: unknown) => {
        if (queue === 'platform.notify') events.push(data as OperatorEvent);
        if (queue === 'email.send') sent.push(data as Sent);
        return Promise.resolve(null);
      },
    },
  };
  const proof = {
    filename: 'p.png',
    content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  };

  beforeAll(async () => {
    db = appDatabase();
    first = { ...(await superAdmin(db)), clock };
    second = { ...(await superAdmin(db)), clock };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `on.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Omega S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2030-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('a7'.repeat(32)), clock },
    );
  });

  afterAll(() => db.close());

  it('tells every super admin of a reported transfer, once, in the bell and by email', async () => {
    const payer = await resolveActor(db, {
      userId: ownerId,
      tenantId: org.realTenantId,
      clock,
    });
    const payment = await startPaidPlan(payer, db, { planKey: 'STARTER', interval: 'MONTHLY' });
    await submitProof(
      payer,
      db,
      { paymentId: payment.id, reference: 'SPI-9', files: [proof] },
      notice,
    );
    // The company's transaction only queues it: platform tables are written in system context.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'PAYMENT_REPORTED', tenantId: org.realTenantId });
    const before = await platformNotificationSummary(first, db, 100);
    expect(before.items.map((item) => item.params.code)).not.toContain(payment.code);

    const deliver = () => deliverOperatorEvent({ db, notice }, events[0]!);
    await deliver();
    await deliver();
    for (const operator of [first, second]) {
      const mine = await platformNotificationSummary(operator, db, 100);
      const told = mine.items.filter((item) => item.params.code === payment.code);
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({
        type: 'PAYMENT_REPORTED',
        link: '/admin/payments',
        readAt: null,
        params: { name: 'Omega S.A.', amount: payment.totalAmount },
      });
    }
    const emails = sent.filter((message) => message.template === 'paymentReported');
    expect(emails.length).toBeGreaterThanOrEqual(2);
    expect(emails[0]!.params).toMatchObject({
      organization: 'Omega S.A.',
      amount: `$${payment.totalAmount}`,
    });
  });

  it('marks only the caller’s own notices as read', async () => {
    const before = await platformNotificationSummary(first, db);
    expect(before.unread).toBeGreaterThanOrEqual(1);
    const otherBefore = (await platformNotificationSummary(second, db)).unread;
    const target = before.items[0]!;
    // Someone else’s receipt id changes nothing.
    await markPlatformRead(second, db, [target.id]);
    expect((await platformNotificationSummary(first, db)).unread).toBe(before.unread);

    await markPlatformRead(first, db, [target.id]);
    expect((await platformNotificationSummary(first, db)).unread).toBe(before.unread - 1);
    expect((await platformNotificationSummary(second, db)).unread).toBe(otherBefore);

    await markAllPlatformRead(first, db);
    expect((await platformNotificationSummary(first, db)).unread).toBe(0);
    const list = await listPlatformNotifications(first, db, { unreadOnly: true });
    expect(list.items).toHaveLength(0);
  });

  it('is for super admins only, and no company can write it', async () => {
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Nadie', email: `on.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const notOperator = { userId: user!.id, isSuperAdmin: true as const, clock };
    await expect(platformNotificationSummary(notOperator, db)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) =>
        executeSql(`UPDATE platform_notification_receipts SET read_at = now()`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
