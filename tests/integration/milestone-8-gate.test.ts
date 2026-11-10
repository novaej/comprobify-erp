import { randomUUID } from 'node:crypto';
import {
  billingOverview,
  confirmCardPayment,
  createClient,
  createKeyCipher,
  fixedClock,
  invoicingQueue,
  markPaymentInvoiced,
  onboardOrganization,
  requestPlanChange,
  requestSeats,
  resolveActor,
  reviewPayment,
  runBillingDay,
  startCardPayment,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type BillingDayDeps,
  type ChangeResult,
  type CreatedOrganization,
  type PayphoneDeps,
  type PlatformActor,
} from '@comprobify/core';
import { createFakePayphone, createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument, superAdmin, testLogger } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// Milestone 8 gate (PRD section 15): the full upgrade, renewal and expiry cycle on a fake clock,
// one company, every step through the functions the screens and the worker call. Placeholder
// prices (ADR-027): Emprende 9.90, Negocio 29.90, an extra user 4.00, IVA 15 %, half up.
describe('Milestone 8 gate: upgrade, renewal and expiry on a fake clock', () => {
  const clock = fixedClock('2027-01-04T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let company: CreatedOrganization;
  let issuer: CreatedOrganization;
  let ownerId: string;
  let ruc: string;
  const fake = createFakePayphone();
  const card: NonNullable<PayphoneDeps> = {
    gateway: fake.gateway,
    token: 'test-token-not-a-secret-0003',
    storeId: 'store-1',
    production: false,
    instance: 'gate',
  };
  let sent: { to: string; template: string }[] = [];
  let daily: BillingDayDeps;

  const at = (date: string) => clock.set(`${date}T11:00:00Z`);
  const owner = (tenantId = company.twinTenantId): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId, clock });
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: milestone 8 gate', ({ executeSql }) => executeSql(text, values));
  const subscription = async () =>
    (
      await sql(
        `SELECT p.key AS plan, s.status, s.period_start::text AS start,
                s.period_end::text AS "end", s.extra_seats AS seats
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`,
        [company.realTenantId],
      )
    ).rows[0];
  const byTransfer = async (paymentId: string) => {
    await submitProof(await owner(), db, {
      paymentId,
      reference: `SPI-${paymentId.slice(0, 6)}`,
      files: [{ filename: 'p.png', content: PNG }],
    });
    await reviewPayment({ ...operator, clock }, db, { paymentId, decision: 'VERIFIED' });
  };
  const byCard = async (paymentId: string) => {
    const session = await startCardPayment(await owner(), db, { paymentId }, card);
    return confirmCardPayment(
      await owner(),
      db,
      {
        id: fake.pay(session.clientTransactionId, { amount: session.amount }),
        clientTransactionId: session.clientTransactionId,
      },
      card,
      testLogger(),
    );
  };
  const paymentOf = (result: ChangeResult) => (result.applied === 'NOW' ? result.payment! : null);
  const day = async (date: string) => {
    at(date);
    sent = [];
    await runBillingDay(daily);
    return sent.filter((email) => email.to === ownerEmail).map((email) => email.template);
  };
  let ownerEmail: string;
  const renewal = async () =>
    (
      await sql(
        `SELECT id, status, total_amount AS total FROM payments
         WHERE tenant_id = $1 AND purpose = 'RENEWAL' ORDER BY created_at DESC LIMIT 1`,
        [company.realTenantId],
      )
    ).rows[0] as { id: string; status: string; total: string };

  const onboard = async (legalName: string, userId: string, companyRuc: string) =>
    onboardOrganization(
      db,
      {
        ownerUserId: userId,
        ruc: companyRuc,
        legalName,
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc: companyRuc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2028-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('da'.repeat(32)), clock },
    );

  beforeAll(async () => {
    db = appDatabase();
    operator = await superAdmin(db);
    ownerEmail = `gate8.${randomUUID()}@example.com`;
    const users = await db.identity
      .insert(schema.users)
      .values([
        { name: 'Owner', email: ownerEmail, emailVerified: true },
        { name: 'Operator', email: `gate8op.${randomUUID()}@example.com`, emailVerified: true },
      ])
      .returning({ id: schema.users.id });
    ownerId = users[0]!.id;
    ruc = testRuc();
    company = await onboard('Omega Gate S.A.', ownerId, ruc);
    issuer = await onboard('Operadora Gate S.A.', users[1]!.id, testRuc());
    daily = {
      db,
      clock,
      logger: testLogger(),
      appUrl: 'https://app.test',
      jobs: {
        enqueue: (_tx, queue, data) => {
          if (queue === 'email.send') sent.push(data as { to: string; template: string });
          return Promise.resolve(null);
        },
      },
    };
  });

  afterAll(async () => {
    await db.close();
  });

  it('starts Emprende by transfer, verified, and its invoice is recorded', async () => {
    const initial = await startPaidPlan(await owner(), db, {
      planKey: 'STARTER',
      interval: 'MONTHLY',
    });
    expect(initial).toMatchObject({ baseAmount: '9.90', ivaAmount: '1.49', totalAmount: '11.39' });
    await byTransfer(initial.id);
    expect(await subscription()).toMatchObject({
      plan: 'STARTER',
      status: 'ACTIVE',
      start: '2027-01-04',
      end: '2027-02-04',
    });

    // The operator's own factura for it, issued from its company and recorded by access key.
    expect((await invoicingQueue({ ...operator, clock }, db)).map((row) => row.id)).toContain(
      initial.id,
    );
    const invoice = await insertTestDocument(db, issuer.realTenantId, {
      buyerIdentification: ruc,
      amounts: { base: '9.90', iva: '1.49', total: '11.39' },
    });
    for (const status of ['PENDING_SEND', 'RECEIVED'])
      await sql(`UPDATE documents SET status = $2 WHERE id = $1`, [invoice.id, status]);
    await sql(
      `UPDATE documents SET status = 'AUTHORIZED', authorization_number = access_key WHERE id = $1`,
      [invoice.id],
    );
    await markPaymentInvoiced({ ...operator, clock }, db, {
      paymentId: initial.id,
      accessKey: invoice.accessKey,
    });
    expect((await invoicingQueue({ ...operator, clock }, db)).map((row) => row.id)).not.toContain(
      initial.id,
    );
  });

  it('upgrades to Negocio mid-period by card, prorated by the days left', async () => {
    at('2027-01-19');
    // (29.90 - 9.90) × 16 of 31 days = 10.32, plus 1.55 of IVA.
    const upgrade = paymentOf(
      await requestPlanChange(await owner(), db, { planKey: 'BUSINESS', interval: 'MONTHLY' }),
    );
    expect(upgrade).toMatchObject({
      purpose: 'TIER_CHANGE',
      baseAmount: '10.32',
      ivaAmount: '1.55',
      totalAmount: '11.87',
    });
    await expect(byCard(upgrade!.id)).resolves.toMatchObject({ status: 'APPROVED' });
    // The plan changes now; the period stays.
    expect(await subscription()).toMatchObject({
      plan: 'BUSINESS',
      start: '2027-01-04',
      end: '2027-02-04',
    });
    expect((await owner()).entitlements.features).toContain('INVENTORY');
  });

  it('opens the renewal a week ahead, and a payment in the grace keeps the billing day', async () => {
    expect(await day('2027-01-27')).toEqual([]);
    expect(await day('2027-01-28')).toEqual(['renewalDue']);
    expect(await renewal()).toMatchObject({ status: 'PENDING', total: '34.39' });
    expect(await day('2027-02-04')).toEqual(['graceStarted']);
    expect((await owner()).standing).toBe('GOOD');

    at('2027-02-06');
    await byTransfer((await renewal()).id);
    expect(await subscription()).toMatchObject({
      plan: 'BUSINESS',
      status: 'ACTIVE',
      start: '2027-02-04',
      end: '2027-03-04',
    });
    expect(await day('2027-02-11')).toEqual([]);
  });

  it('adds an extra user by card, prorated, and it renews with the plan', async () => {
    at('2027-02-10');
    // 4.00 × 22 of 28 days = 3.14, plus 0.47 of IVA.
    const seats = paymentOf(await requestSeats(await owner(), db, { extraSeats: 1 }));
    expect(seats).toMatchObject({ baseAmount: '3.14', ivaAmount: '0.47', totalAmount: '3.61' });
    await byCard(seats!.id);
    expect(await subscription()).toMatchObject({ seats: 1 });
    // Negocio 29.90 + one user 4.00 = 33.90, plus 5.09 of IVA.
    expect(await day('2027-02-25')).toEqual(['renewalDue']);
    expect(await renewal()).toMatchObject({ status: 'PENDING', total: '38.99' });
  });

  it('runs out unpaid: grace, past due with writes blocked, then Gratis without its extras', async () => {
    expect(await day('2027-03-04')).toEqual(['graceStarted']);
    const client = (ctx: ActorContext) =>
      createClient(ctx, db, {
        idType: '05',
        identification: '1710034065',
        name: 'Cliente',
        emails: [],
        address: null,
      });
    await client(await owner());

    expect(await day('2027-03-11')).toEqual(['pastDue']);
    for (const tenantId of [company.realTenantId, company.twinTenantId]) {
      const ctx = await owner(tenantId);
      expect(ctx.standing).toBe('PAST_DUE');
      await expect(client(ctx)).rejects.toMatchObject({ code: 'ACCOUNT_PAST_DUE' });
    }
    expect(await day('2027-03-24')).toEqual([]);

    expect(await day('2027-03-25')).toEqual(['movedToFree']);
    expect(await subscription()).toMatchObject({
      plan: 'FREE',
      status: 'ACTIVE',
      start: '2027-03-04',
      end: null,
      seats: 0,
    });
    expect(await renewal()).toMatchObject({ status: 'CANCELLED' });
    const ctx = await owner();
    expect(ctx.standing).toBe('GOOD');
    expect(ctx.entitlements.features).not.toContain('INVENTORY');
    expect(ctx.entitlements.limits.DOCUMENT_QUOTA).toBe(5);
    expect(await day('2027-03-26')).toEqual([]);

    // What the page shows afterwards: Gratis, with the whole history.
    const view = await billingOverview(ctx, db);
    expect(view.subscription).toMatchObject({ planKey: 'FREE', periodEnd: null });
    expect(view.payments.map((payment) => [payment.purpose, payment.status])).toEqual([
      ['RENEWAL', 'CANCELLED'],
      ['SEAT_CHANGE', 'VERIFIED'],
      ['RENEWAL', 'VERIFIED'],
      ['TIER_CHANGE', 'VERIFIED'],
      ['INITIAL', 'VERIFIED'],
    ]);
    const { rows } = await sql(
      `SELECT action FROM audit_events WHERE tenant_id = $1 AND actor_user_id IS NULL
         AND action LIKE 'subscription.%' ORDER BY occurred_at`,
      [company.realTenantId],
    );
    expect(rows.map((row) => (row as { action: string }).action)).toEqual([
      'subscription.renewal_due',
      'subscription.grace_started',
      'subscription.renewal_due',
      'subscription.grace_started',
      'subscription.past_due',
      'subscription.moved_to_free',
    ]);
  });
});
