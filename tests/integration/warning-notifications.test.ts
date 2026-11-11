import { randomUUID } from 'node:crypto';
import {
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  watchCertificates,
  watchQuota,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { and, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument, testLogger } from './helpers';

type Sent = { to: string; template: string; params: Record<string, string> };

// FR-NOT-2 (ADR-036): the certificate running out and the document quota filling up tell the
// company once per step, however often the sweeps run.
describe('warning notifications', () => {
  const clock = fixedClock(new Date().toISOString());
  const keyCipher = createKeyCipher('f'.repeat(64));
  let db: Database;
  let org: CreatedOrganization;
  const sent: Sent[] = [];
  const ownerEmail = `wn.${randomUUID()}@example.com`;
  const notice = {
    appUrl: 'https://app.test',
    jobs: {
      enqueue: (_tx: unknown, queue: string, data: unknown) => {
        if (queue === 'email.send') sent.push(data as Sent);
        return Promise.resolve(null);
      },
    },
  };
  const deps = () => ({ db, notice, clock, logger: testLogger() });
  const told = (type: string) =>
    db.withSystem('test: read notifications', ({ db: tx }) =>
      tx
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.tenantId, org.realTenantId),
            eq(schema.notifications.type, type as 'QUOTA_NEARING'),
          ),
        ),
    );
  // The sweeps cover every company in the database, so keep to this one's owner.
  const emailed = (template: string) =>
    sent.filter((message) => message.template === template && message.to === ownerEmail);
  const day = 86_400_000;
  const certificateEndsIn = (days: number) =>
    db.withSystem('test: move the certificate end', ({ executeSql }) =>
      executeSql(`UPDATE certificates SET not_after = $1 WHERE tenant_id = $2 AND active`, [
        new Date(clock.now().getTime() + days * day + 3_600_000),
        org.realTenantId,
      ]),
    );

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: ownerEmail, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: 'Sigma S.A.',
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
      { keyCipher, clock },
    );
  });

  afterAll(() => db.close());

  it('reminds at 30, 15 and 7 days and when it ended, each once', async () => {
    await watchCertificates(deps());
    expect(await told('CERTIFICATE_EXPIRING')).toHaveLength(0);

    await certificateEndsIn(29);
    await watchCertificates(deps());
    await watchCertificates(deps());
    let rows = await told('CERTIFICATE_EXPIRING');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.params).toMatchObject({ count: '29' });
    expect(emailed('certificateExpiring')).toHaveLength(1);
    expect(emailed('certificateExpiring')[0]!.params).toMatchObject({ count: '29' });

    // 28 days is still the 30-day step: nothing new.
    await certificateEndsIn(28);
    await watchCertificates(deps());
    expect(await told('CERTIFICATE_EXPIRING')).toHaveLength(1);

    await certificateEndsIn(14);
    await watchCertificates(deps());
    await certificateEndsIn(5);
    await watchCertificates(deps());
    expect(await told('CERTIFICATE_EXPIRING')).toHaveLength(3);

    // Once it has ended, one more notice, and the earlier steps are not told again.
    await certificateEndsIn(-2);
    await watchCertificates(deps());
    await watchCertificates(deps());
    rows = await told('CERTIFICATE_EXPIRED');
    expect(rows).toHaveLength(1);
    expect(emailed('certificateExpired')).toHaveLength(1);
    expect(await told('CERTIFICATE_EXPIRING')).toHaveLength(3);
  });

  it('warns at 80 % of the quota and at the limit, once per period', async () => {
    // The free plan allows 5 documents a period.
    await watchQuota(deps());
    expect(await told('QUOTA_NEARING')).toHaveLength(0);
    for (let i = 0; i < 3; i++) await insertTestDocument(db, org.realTenantId);
    await watchQuota(deps());
    expect(await told('QUOTA_NEARING')).toHaveLength(0);

    await insertTestDocument(db, org.realTenantId);
    await watchQuota(deps());
    await watchQuota(deps());
    const nearing = await told('QUOTA_NEARING');
    expect(nearing).toHaveLength(1);
    expect(nearing[0]!.params).toMatchObject({ count: '5' });
    expect(emailed('quotaNearing')).toHaveLength(1);
    expect(await told('QUOTA_REACHED')).toHaveLength(0);

    await insertTestDocument(db, org.realTenantId);
    await watchQuota(deps());
    await watchQuota(deps());
    expect(await told('QUOTA_REACHED')).toHaveLength(1);
    expect(emailed('quotaReached')).toHaveLength(1);
    expect(await told('QUOTA_NEARING')).toHaveLength(1);
  });

  it('tells only members who can act on it', async () => {
    const receipts = await db.withSystem('test: read receipts', ({ db: tx }) =>
      tx
        .select({ userId: schema.notificationReceipts.userId })
        .from(schema.notificationReceipts)
        .innerJoin(
          schema.notifications,
          eq(schema.notifications.id, schema.notificationReceipts.notificationId),
        )
        .where(eq(schema.notifications.tenantId, org.realTenantId)),
    );
    // The owner is the only member and holds both permissions.
    expect(receipts.length).toBeGreaterThanOrEqual(4);
  });
});
