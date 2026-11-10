import { randomUUID } from 'node:crypto';
import {
  buyPack,
  cancelPayment,
  confirmCardPayment,
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  reconcileCardPayments,
  resolveActor,
  startCardPayment,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type CreatedOrganization,
  type PayphoneDeps,
} from '@comprobify/core';
import { createFakePayphone, createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, testLogger, testNotice } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// FR-BILL-3 (ADR-033): card payments against a fake Payphone. Placeholder prices: Emprende 9.90
// (11.39 with IVA), a 100-document pack 5.00 (5.75).
describe('card payments through Payphone', () => {
  // Real time: attempts are dated by the database, and the sweep compares against the clock.
  const clock = fixedClock(new Date().toISOString());
  const later = () => fixedClock(new Date(Date.now() + 11 * 60_000).toISOString());
  const logger = testLogger();
  let db: Database;
  let org: CreatedOrganization;
  let ownerId: string;
  let fake: ReturnType<typeof createFakePayphone>;
  let deps: NonNullable<PayphoneDeps>;

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
    db.withSystem('test: card payments', ({ executeSql }) => executeSql(text, values));
  const payment = async (id: string) =>
    (await sql(`SELECT status, method FROM payments WHERE id = $1`, [id])).rows[0];
  const attempt = async (clientTransactionId: string) =>
    (
      await sql(
        `SELECT status, payphone_transaction_id::int AS "payphoneId", applied_at IS NOT NULL AS applied,
                card_brand AS brand, confirm_response AS response
         FROM payphone_transactions WHERE client_transaction_id = $1`,
        [clientTransactionId],
      )
    ).rows[0] as {
      status: string;
      payphoneId: number | null;
      applied: boolean;
      brand: string | null;
      response: Record<string, unknown> | null;
    };
  const confirm = async (id: number, clientTransactionId: string) =>
    confirmCardPayment(await owner(), db, { id, clientTransactionId }, deps, logger, testNotice);
  const pack = async () => buyPack(await owner(), db, { packSize: 100 });
  const reconcile = () =>
    reconcileCardPayments({
      db,
      gateway: fake.gateway,
      clock: later(),
      logger,
      notice: testNotice,
    });

  beforeAll(async () => {
    db = appDatabase();
    fake = createFakePayphone();
    deps = {
      gateway: fake.gateway,
      token: 'test-token-not-a-secret-0001',
      storeId: 'store-1',
      production: false,
      instance: 'ci-runner',
    };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `pp.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Upsilon S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2028-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('d7'.repeat(32)), clock },
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the database to the rules', async () => {
    const { rows } = await sql(
      `SELECT prosrc FROM pg_proc WHERE proname = 'app_card_attempt_status_check'`,
    );
    expect((rows[0] as { prosrc: string }).prosrc).toContain(schema.cardAttemptStatusTriggerBody());
  });

  it('pays a plan by card at once, and a second load of the return page asks Payphone nothing', async () => {
    const initial = await startPaidPlan(await owner(), db, {
      planKey: 'STARTER',
      interval: 'MONTHLY',
    });
    expect(
      await failure(startCardPayment(await owner(), db, { paymentId: initial.id }, null)),
    ).toBe('CARD_NOT_AVAILABLE');
    const session = await startCardPayment(await owner(), db, { paymentId: initial.id }, deps);
    // The widget's own configuration: the amounts in cents always add up.
    expect(session).toMatchObject({
      amount: 1139,
      tax: 149,
      amountWithTax: 990,
      amountWithoutTax: 0,
      currency: 'USD',
      storeId: 'store-1',
      reference: `Comprobify ${initial.code} · ci-runner`,
    });
    expect(session.clientTransactionId).toMatch(/^[0-9a-f]{16}$/);

    const id = fake.pay(session.clientTransactionId, { amount: 1139 });
    await expect(confirm(id, session.clientTransactionId)).resolves.toMatchObject({
      status: 'APPROVED',
      paymentId: initial.id,
    });
    expect(await payment(initial.id)).toEqual({ status: 'VERIFIED', method: 'PAYPHONE_CARD' });
    expect((await owner()).entitlements.features).toContain('DOC_TYPE_04');
    const stored = await attempt(session.clientTransactionId);
    expect(stored).toMatchObject({ status: 'APPROVED', payphoneId: id, applied: true });
    // Payphone's answer is kept without the payer's personal data.
    expect(stored.response).toMatchObject({ statusCode: 3, amount: 1139 });
    expect(stored.response).not.toHaveProperty('email');
    expect(stored.response).not.toHaveProperty('document');

    const calls = fake.calls.length;
    await expect(confirm(id, session.clientTransactionId)).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(fake.calls).toHaveLength(calls);
    expect(
      await failure(startCardPayment(await owner(), db, { paymentId: initial.id }, deps)),
    ).toBe('PAYMENT_NOT_PAYABLE');
  });

  it('leaves a declined card or a mismatched amount unpaid, ready for another attempt', async () => {
    const payment1 = await pack();
    const declined = await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    const id = fake.pay(declined.clientTransactionId, { amount: 575, statusCode: 2 });
    await expect(confirm(id, declined.clientTransactionId)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    expect(await payment(payment1.id)).toMatchObject({ status: 'PENDING' });

    const odd = await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    const oddId = fake.pay(odd.clientTransactionId, { amount: 100 });
    await expect(confirm(oddId, odd.clientTransactionId)).resolves.toMatchObject({
      status: 'ERROR',
    });
    expect(await payment(payment1.id)).toMatchObject({ status: 'PENDING' });

    const good = await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    await confirm(fake.pay(good.clientTransactionId, { amount: 575 }), good.clientTransactionId);
    expect(await payment(payment1.id)).toMatchObject({ status: 'VERIFIED' });
  });

  it('applies two charges from two tabs once, and flags the second for a refund by hand', async () => {
    const payment1 = await pack();
    const first = await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    const second = await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    const firstId = fake.pay(first.clientTransactionId, { amount: 575 });
    const secondId = fake.pay(second.clientTransactionId, { amount: 575 });
    await confirm(firstId, first.clientTransactionId);
    await expect(confirm(secondId, second.clientTransactionId)).resolves.toMatchObject({
      status: 'DUPLICATE',
    });
    expect(await attempt(second.clientTransactionId)).toMatchObject({
      status: 'DUPLICATE',
      applied: false,
    });
    // One pack, not two.
    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM document_packs WHERE payment_id = $1`,
      [payment1.id],
    );
    expect(rows[0]).toEqual({ n: 1 });
    const events = await sql(
      `SELECT details->>'payphoneTransactionId' AS id FROM audit_events
       WHERE tenant_id = $1 AND action = 'payment.card_duplicate'`,
      [org.realTenantId],
    );
    expect(events.rows).toEqual([{ id: String(secondId) }]);

    // A payment cancelled while the widget was open is the same case.
    const payment2 = await pack();
    const open = await startCardPayment(await owner(), db, { paymentId: payment2.id }, deps);
    await cancelPayment(await owner(), db, payment2.id);
    await expect(
      confirm(fake.pay(open.clientTransactionId, { amount: 575 }), open.clientTransactionId),
    ).resolves.toMatchObject({ status: 'DUPLICATE' });
  });

  it('keeps an unanswered charge pending with its id, and the sweep recovers it', async () => {
    const payment1 = await pack();
    const session = await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    const id = fake.pay(session.clientTransactionId, { amount: 575, unreachable: 2 });
    await expect(confirm(id, session.clientTransactionId)).resolves.toMatchObject({
      status: 'PENDING',
    });
    expect(await attempt(session.clientTransactionId)).toMatchObject({
      status: 'PENDING',
      payphoneId: id,
    });
    // Not stale yet: the sweep leaves it to the payer's own page.
    await reconcileCardPayments({ db, gateway: fake.gateway, clock, logger, notice: testNotice });
    expect(await attempt(session.clientTransactionId)).toMatchObject({ status: 'PENDING' });
    // Still unreachable once, then answered.
    await reconcile();
    expect(await attempt(session.clientTransactionId)).toMatchObject({ status: 'PENDING' });
    await reconcile();
    expect(await attempt(session.clientTransactionId)).toMatchObject({
      status: 'APPROVED',
      applied: true,
    });
    expect(await payment(payment1.id)).toMatchObject({ status: 'VERIFIED' });
  });

  it('expires an attempt that never came back, without asking Payphone', async () => {
    const payment1 = await pack();
    const session = await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    const calls = fake.calls.length;
    await reconcile();
    expect(await attempt(session.clientTransactionId)).toMatchObject({ status: 'EXPIRED' });
    expect(fake.calls).toHaveLength(calls);
    expect(await payment(payment1.id)).toMatchObject({ status: 'PENDING' });
    await cancelPayment(await owner(), db, payment1.id);
  });

  it('finishes a charge approved but never applied', async () => {
    const payment1 = await pack();
    const session = await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    // What a crash between the two phases leaves.
    await sql(
      `UPDATE payphone_transactions SET status = 'APPROVED', payphone_transaction_id = 1,
         confirmed_at = now() WHERE client_transaction_id = $1`,
      [session.clientTransactionId],
    );
    expect(await reconcile()).toMatchObject({ applied: 1 });
    expect(await payment(payment1.id)).toMatchObject({ status: 'VERIFIED' });
  });

  it('refuses what a card must not pay', async () => {
    const payment1 = await pack();
    for (let i = 0; i < 10; i++)
      await startCardPayment(await owner(), db, { paymentId: payment1.id }, deps);
    expect(
      await failure(startCardPayment(await owner(), db, { paymentId: payment1.id }, deps)),
    ).toBe('CARD_TOO_MANY_ATTEMPTS');
    await reconcile();
    // A transfer under review could otherwise be paid twice.
    await submitProof(await owner(), db, {
      paymentId: payment1.id,
      reference: 'SPI-1',
      files: [{ filename: 'p.png', content: PNG }],
    });
    expect(
      await failure(startCardPayment(await owner(), db, { paymentId: payment1.id }, deps)),
    ).toBe('PAYMENT_IN_REVIEW');
    // Under Payphone's $1.00 minimum.
    const small = (
      await sql(
        `INSERT INTO payments (tenant_id, subscription_id, code, purpose, target_seats, base_amount,
           iva_rate, iva_amount, total_amount)
         SELECT tenant_id, id, 'CB-SMAPAY22', 'SEAT_CHANGE', 1, '0.80', '15.00', '0.12', '0.92'
         FROM subscriptions WHERE tenant_id = $1 RETURNING id`,
        [org.realTenantId],
      )
    ).rows[0] as { id: string };
    expect(await failure(startCardPayment(await owner(), db, { paymentId: small.id }, deps))).toBe(
      'CARD_AMOUNT_TOO_LOW',
    );
  });
});
