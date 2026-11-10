import { randomUUID } from 'node:crypto';
import {
  buyPack,
  createKeyCipher,
  fixedClock,
  ivaRateOn,
  ivaRates,
  onboardOrganization,
  resolveActor,
  runBillingDay,
  scheduleIvaRate,
  submitProof,
  withdrawIvaRate,
  type ActorContext,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin, testLogger } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// FR-BILL-2 (ADR-034): the IVA on subscriptions, by date, and what a new rate does to payments
// nobody has paid yet. Far in the future, so no other test sees the rate it records.
describe('the IVA rate and its history', () => {
  const clock = fixedClock('2098-12-20T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let org: CreatedOrganization;
  let ownerId: string;
  let ownerEmail: string;
  let sent: { to: string; template: string; params: Record<string, string> }[] = [];
  const owner = (): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: IVA rates', ({ executeSql }) => executeSql(text, values));
  const rateOn = (on: string) =>
    db.withSystem('test: the rate on a day', ({ db: tx }) => ivaRateOn(tx, on));
  const payment = async (id: string) =>
    (
      await sql(
        `SELECT iva_rate AS rate, iva_amount AS iva, total_amount AS total FROM payments WHERE id = $1`,
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    db = appDatabase();
    operator = { ...(await superAdmin(db)), clock };
    ownerEmail = `iva.${randomUUID()}@example.com`;
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: ownerEmail, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Psi S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2099-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('db'.repeat(32)), clock },
    );
  });

  it('starts at 15 %, and keeps every rate as history', async () => {
    await expect(rateOn('2024-03-31')).rejects.toThrow('No IVA rate in force');
    await expect(rateOn('2024-04-01')).resolves.toBe('15.00');
    // History: the rate itself never changes, and the app role can't write it at all.
    await expect(
      sql(`UPDATE iva_rates SET rate = 12 WHERE effective_on = '2024-04-01'`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) =>
        executeSql(`INSERT INTO iva_rates (rate, effective_on) VALUES (1, '2099-02-01')`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('schedules a rate from today on, once per day, and withdraws one still to come', async () => {
    expect(
      await failure(scheduleIvaRate(operator, db, { rate: '13', effectiveOn: '2098-12-01' })),
    ).toBe('IVA_DATE_PAST');
    await scheduleIvaRate(operator, db, { rate: '13', effectiveOn: '2099-01-01' });
    expect(
      await failure(scheduleIvaRate(operator, db, { rate: '14', effectiveOn: '2099-01-01' })),
    ).toBe('IVA_DATE_TAKEN');
    await expect(rateOn('2098-12-31')).resolves.toBe('15.00');
    await expect(rateOn('2099-01-01')).resolves.toBe('13.00');
    const lines = await ivaRates(operator, db);
    expect(lines.filter((line) => line.effectiveOn >= '2099-01-01')).toMatchObject([
      { rate: '13.00', state: 'SCHEDULED' },
    ]);
    expect(lines.find((line) => line.state === 'CURRENT')).toMatchObject({ rate: '15.00' });
    const current = lines.find((line) => line.state === 'CURRENT')!;
    expect(await failure(withdrawIvaRate(operator, db, current.id))).toBe('IVA_NOT_WITHDRAWABLE');
  });

  it('charges an unpaid payment the new rate on its day and tells the payer; a reported one keeps its own', async () => {
    const unpaid = await buyPack(await owner(), db, { packSize: 100 });
    expect(await payment(unpaid.id)).toEqual({ rate: '15.00', iva: '0.75', total: '5.75' });
    // A second open payment can't be made, so the reported one is set up in the database.
    const reported = (
      await sql(
        `INSERT INTO payments (tenant_id, subscription_id, code, purpose, pack_size, status,
           base_amount, iva_rate, iva_amount, total_amount, reported_at)
         SELECT tenant_id, id, 'CB-REPRTED2', 'DOCUMENT_PACK', 500, 'REPORTED',
           '20.00', '15.00', '3.00', '23.00', now()
         FROM subscriptions WHERE tenant_id = $1 RETURNING id`,
        [org.realTenantId],
      )
    ).rows[0] as { id: string };

    const daily = {
      db,
      clock,
      logger: testLogger(),
      appUrl: 'https://app.test',
      jobs: {
        enqueue: (_tx: unknown, queue: string, data: unknown) => {
          if (queue === 'email.send') sent.push(data as (typeof sent)[number]);
          return Promise.resolve(null);
        },
      },
    };
    // The day before, nothing moves.
    clock.set('2098-12-31T15:00:00Z');
    await runBillingDay(daily);
    expect(await payment(unpaid.id)).toMatchObject({ rate: '15.00' });

    clock.set('2099-01-01T15:00:00Z');
    sent = [];
    await runBillingDay(daily);
    // 5.00 at 13 % is 0.65.
    expect(await payment(unpaid.id)).toEqual({ rate: '13.00', iva: '0.65', total: '5.65' });
    expect(await payment(reported.id)).toEqual({ rate: '15.00', iva: '3.00', total: '23.00' });
    const email = sent.find((row) => row.to === ownerEmail);
    expect(email).toMatchObject({
      template: 'paymentRepriced',
      params: { amount: '$5.65', rate: '13 %' },
    });
    const { rows } = await sql(
      `SELECT details->>'fromTotal' AS "from", details->>'toTotal' AS "to" FROM audit_events
       WHERE tenant_id = $1 AND action = 'payment.repriced'`,
      [org.realTenantId],
    );
    expect(rows).toEqual([{ from: '5.75', to: '5.65' }]);
    // Once is enough.
    sent = [];
    await runBillingDay(daily);
    expect(sent.filter((row) => row.to === ownerEmail)).toEqual([]);
  });

  it('charges a payment made after the change at the new rate', async () => {
    await sql(
      `UPDATE payments SET status = 'CANCELLED', cancelled_at = now() WHERE tenant_id = $1 AND status = 'PENDING'`,
      [org.realTenantId],
    );
    await sql(
      `UPDATE payments SET status = 'REJECTED', rejection_reason = 'OTHER' WHERE tenant_id = $1 AND status = 'REPORTED'`,
      [org.realTenantId],
    );
    await sql(
      `UPDATE payments SET status = 'CANCELLED', cancelled_at = now() WHERE tenant_id = $1 AND status = 'REJECTED'`,
      [org.realTenantId],
    );
    const next = await buyPack(await owner(), db, { packSize: 100 });
    expect(await payment(next.id)).toEqual({ rate: '13.00', iva: '0.65', total: '5.65' });
    // Not part of the rate change: the transfer flow still takes this payment as is.
    await submitProof(await owner(), db, {
      paymentId: next.id,
      reference: 'SPI-1',
      files: [{ filename: 'p.png', content: PNG }],
    });
  });

  afterAll(async () => {
    // Leave the far-future rate withdrawn, as if recorded by mistake.
    const lines = await ivaRates({ ...operator, clock: fixedClock('2098-12-20T15:00:00Z') }, db);
    const future = lines.find(
      (line) => line.effectiveOn === '2099-01-01' && line.state === 'SCHEDULED',
    );
    if (future)
      await withdrawIvaRate(
        { ...operator, clock: fixedClock('2098-12-20T15:00:00Z') },
        db,
        future.id,
      );
    await db.close();
  });
});
