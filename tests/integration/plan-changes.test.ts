import { randomUUID } from 'node:crypto';
import {
  buyAddOn,
  cancelScheduledChange,
  cancelSubscription,
  createKeyCipher,
  dropAddOn,
  fixedClock,
  getPayment,
  onboardOrganization,
  openRenewal,
  previewPlanChange,
  refundPayment,
  requestPlanChange,
  requestSeats,
  resolveActor,
  resumeSubscription,
  reviewPayment,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type ChangeResult,
  type CreatedOrganization,
  type PaymentView,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// FR-BILL-5, FR-PLAN-1a (ADR-030): a paying company changes its plan, seats and add-ons.
// Placeholder prices: Emprende 9.90, Negocio 29.90, Empresa 79.90, Guías 5.00, seat 4.00.
describe('plan changes', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let org: CreatedOrganization;
  let ownerId: string;

  const owner = (): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });
  const at = (date: string) => clock.set(`${date}T15:00:00Z`);
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: plan changes', ({ executeSql }) => executeSql(text, values));
  const subscription = async () =>
    (
      await sql(
        `SELECT p.key AS plan, s.interval, s.status, s.period_start::text AS start,
                s.period_end::text AS "end", s.extra_seats AS seats,
                pp.key AS "pendingPlan", s.pending_interval AS "pendingInterval",
                s.pending_seats AS "pendingSeats"
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         LEFT JOIN plans pp ON pp.id = s.pending_plan_id WHERE s.tenant_id = $1`,
        [org.realTenantId],
      )
    ).rows[0];
  const twinPlan = async () =>
    (
      await sql(
        `SELECT p.key FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`,
        [org.twinTenantId],
      )
    ).rows[0];
  // The company reports the transfer and the operator verifies it.
  const pay = async (payment: PaymentView | null) => {
    expect(payment).not.toBeNull();
    await submitProof(await owner(), db, {
      paymentId: payment!.id,
      reference: 'SPI-1',
      files: [{ filename: 'p.png', content: PNG }],
    });
    await reviewPayment({ ...operator, clock }, db, {
      paymentId: payment!.id,
      decision: 'VERIFIED',
    });
  };
  const paymentOf = (result: ChangeResult) => (result.applied === 'NOW' ? result.payment : null);
  const renewal = () =>
    db.withSystem('test: open the renewal', ({ db: tx }) =>
      openRenewal(tx, org.realTenantId, clock.now()),
    );

  beforeAll(async () => {
    db = appDatabase();
    operator = await superAdmin(db);
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `pc.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Chi Rho S.A.',
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
      { keyCipher: createKeyCipher('d4'.repeat(32)), clock },
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('needs a paid period first, and never goes to a free plan except by cancelling', async () => {
    expect(
      await failure(
        requestPlanChange(await owner(), db, { planKey: 'BUSINESS', interval: 'MONTHLY' }),
      ),
    ).toBe('NOT_BILLED');
    at('2026-11-10');
    await pay(await startPaidPlan(await owner(), db, { planKey: 'STARTER', interval: 'MONTHLY' }));
    expect(await subscription()).toMatchObject({
      plan: 'STARTER',
      start: '2026-11-10',
      end: '2026-12-10',
    });
    expect(
      await failure(requestPlanChange(await owner(), db, { planKey: 'FREE', interval: 'MONTHLY' })),
    ).toBe('USE_CANCEL');
    expect(
      await failure(
        requestPlanChange(await owner(), db, { planKey: 'STARTER', interval: 'MONTHLY' }),
      ),
    ).toBe('SAME_PLAN');
  });

  it('upgrades now for the difference over what is left, and keeps the period', async () => {
    // 15 of 30 days left: (29.90 − 9.90) × ½ = 10.00.
    at('2026-11-25');
    expect(
      await previewPlanChange(await owner(), db, { planKey: 'BUSINESS', interval: 'MONTHLY' }),
    ).toMatchObject({ when: 'NOW', amounts: { baseAmount: '10.00', totalAmount: '11.50' } });
    const result = await requestPlanChange(await owner(), db, {
      planKey: 'BUSINESS',
      interval: 'MONTHLY',
    });
    expect(paymentOf(result)).toMatchObject({ purpose: 'TIER_CHANGE', baseAmount: '10.00' });
    // One change at a time.
    expect(await failure(requestSeats(await owner(), db, { extraSeats: 1 }))).toBe(
      'PAYMENT_IN_PROGRESS',
    );
    await pay(paymentOf(result));
    expect(await subscription()).toMatchObject({
      plan: 'BUSINESS',
      start: '2026-11-10',
      end: '2026-12-10',
    });
    expect(await twinPlan()).toEqual({ key: 'BUSINESS' });
  });

  it('adds seats and add-ons, prorated, counting at once, and a refunded add-on goes', async () => {
    const seats = await requestSeats(await owner(), db, { extraSeats: 2 });
    // 2 × 4.00 × ½ = 4.00.
    expect(paymentOf(seats)).toMatchObject({ purpose: 'SEAT_CHANGE', baseAmount: '4.00' });
    await pay(paymentOf(seats));
    // Negocio's 5 users, and 2 more.
    expect((await owner()).entitlements.limits.USERS).toBe(7);
    expect(await failure(buyAddOn(await owner(), db, { moduleKey: 'INVENTORY' }))).toBe(
      'MODULE_IN_PLAN',
    );
    const guides = await buyAddOn(await owner(), db, { moduleKey: 'DELIVERY_GUIDES' });
    expect(paymentOf(guides)).toMatchObject({ purpose: 'ADD_ON', baseAmount: '2.50' });
    await pay(paymentOf(guides));
    expect((await owner()).entitlements.features).toContain('DOC_TYPE_06');
    expect(await failure(buyAddOn(await owner(), db, { moduleKey: 'DELIVERY_GUIDES' }))).toBe(
      'MODULE_ALREADY_ADDED',
    );
    // Money back for an add-on takes the add-on away.
    const bought = await buyAddOn(await owner(), db, { moduleKey: 'BULK_INVOICING' });
    await pay(paymentOf(bought));
    expect((await owner()).entitlements.features).toContain('BULK_INVOICING');
    await refundPayment({ ...operator, clock }, db, {
      paymentId: paymentOf(bought)!.id,
      reason: 'Charged twice',
    });
    expect((await owner()).entitlements.features).not.toContain('BULK_INVOICING');
  });

  it('downgrades and drops seats at the period end, and the renewal charges and applies them', async () => {
    const down = await requestPlanChange(await owner(), db, {
      planKey: 'STARTER',
      interval: 'MONTHLY',
    });
    expect(down).toEqual({ applied: 'PERIOD_END', effectiveOn: '2026-12-10' });
    expect(await requestSeats(await owner(), db, { extraSeats: 1 })).toEqual({
      applied: 'PERIOD_END',
      effectiveOn: '2026-12-10',
    });
    // Nothing moves until then.
    expect(await subscription()).toMatchObject({
      plan: 'BUSINESS',
      seats: 2,
      pendingPlan: 'STARTER',
      pendingSeats: 1,
    });
    // Emprende 9.90 + Guías 5.00 + 1 seat 4.00, as on 10 December.
    const next = await renewal();
    expect(next).toMatchObject({ purpose: 'RENEWAL', baseAmount: '18.90' });
    // Changing their mind replaces the open renewal with one priced again.
    await cancelScheduledChange(await owner(), db);
    const again = await sql(
      `SELECT status, base_amount FROM payments WHERE tenant_id = $1 AND purpose = 'RENEWAL'
       ORDER BY created_at`,
      [org.realTenantId],
    );
    // Negocio 29.90 + Guías 5.00 + 2 seats 8.00.
    expect(again.rows).toEqual([
      { status: 'CANCELLED', base_amount: '18.90' },
      { status: 'PENDING', base_amount: '42.90' },
    ]);
    await requestPlanChange(await owner(), db, { planKey: 'STARTER', interval: 'MONTHLY' });
    await requestSeats(await owner(), db, { extraSeats: 1 });
    const due = (
      await sql(
        `SELECT id, base_amount FROM payments WHERE tenant_id = $1 AND purpose = 'RENEWAL'
         AND status = 'PENDING'`,
        [org.realTenantId],
      )
    ).rows[0] as { id: string; base_amount: string };
    expect(due.base_amount).toBe('18.90');
    await pay(await getPayment(await owner(), db, due.id));
    expect(await subscription()).toEqual({
      plan: 'STARTER',
      interval: 'MONTHLY',
      status: 'ACTIVE',
      start: '2026-12-10',
      end: '2027-01-10',
      seats: 1,
      pendingPlan: null,
      pendingInterval: null,
      pendingSeats: null,
    });
  });

  it('drops an add-on at the period end, and holds a change while a renewal is reviewed', async () => {
    at('2026-12-25');
    expect(await dropAddOn(await owner(), db, { moduleKey: 'DELIVERY_GUIDES' })).toEqual({
      effectiveOn: '2027-01-10',
    });
    // Kept until then; the next renewal leaves it out: 9.90 + 4.00.
    expect((await owner()).entitlements.features).toContain('DOC_TYPE_06');
    const next = await renewal();
    expect(next).toMatchObject({ baseAmount: '13.90' });
    await submitProof(await owner(), db, {
      paymentId: next!.id,
      reference: 'SPI-2',
      files: [{ filename: 'p.png', content: PNG }],
    });
    expect(await failure(requestSeats(await owner(), db, { extraSeats: 0 }))).toBe(
      'RENEWAL_IN_REVIEW',
    );
    await reviewPayment({ ...operator, clock }, db, {
      paymentId: next!.id,
      decision: 'REJECTED',
      reason: 'TRANSFER_NOT_FOUND',
    });
  });

  it('moves to yearly now with the unused month credited, and back to monthly at the end', async () => {
    // 16 of 31 days left of 12-10 → 01-10. Empresa yearly: (79.90 + 4.00) × 10, Guías included;
    // credit (9.90 + 5.00 + 4.00) × 16/31.
    const result = await requestPlanChange(await owner(), db, {
      planKey: 'ENTERPRISE',
      interval: 'YEARLY',
    });
    const payment = paymentOf(result);
    expect(payment).toMatchObject({ purpose: 'TIER_CHANGE', targetInterval: 'YEARLY' });
    expect(payment!.baseAmount).toBe('829.25');
    await pay(payment);
    expect(await subscription()).toMatchObject({
      plan: 'ENTERPRISE',
      interval: 'YEARLY',
      start: '2026-12-25',
      end: '2027-12-25',
    });
    // The month's renewal is no longer owed.
    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM payments WHERE tenant_id = $1 AND purpose = 'RENEWAL'
       AND status IN ('PENDING', 'REJECTED')`,
      [org.realTenantId],
    );
    expect(rows[0]).toEqual({ n: 0 });
    expect(
      await requestPlanChange(await owner(), db, { planKey: 'ENTERPRISE', interval: 'MONTHLY' }),
    ).toEqual({ applied: 'PERIOD_END', effectiveOn: '2027-12-25' });
    expect(await subscription()).toMatchObject({ pendingInterval: 'MONTHLY', pendingPlan: null });
    await cancelScheduledChange(await owner(), db);
  });

  it('cancels to the period end, and can be resumed', async () => {
    expect(await cancelSubscription(await owner(), db)).toEqual({
      effectiveOn: '2027-12-25',
    });
    expect(await subscription()).toMatchObject({ status: 'CANCELLED', plan: 'ENTERPRISE' });
    expect(await renewal()).toBeNull();
    expect(await failure(requestSeats(await owner(), db, { extraSeats: 3 }))).toBe(
      'SUBSCRIPTION_CANCELLED',
    );
    await resumeSubscription(await owner(), db);
    expect(await subscription()).toMatchObject({ status: 'ACTIVE' });
  });

  it('refuses a past-due company until it pays', async () => {
    await sql(`UPDATE subscriptions SET status = 'PAST_DUE' WHERE tenant_id = ANY($1)`, [
      [org.realTenantId, org.twinTenantId],
    ]);
    expect(await failure(requestSeats(await owner(), db, { extraSeats: 3 }))).toBe(
      'ACCOUNT_PAST_DUE',
    );
    await sql(`UPDATE subscriptions SET status = 'ACTIVE' WHERE tenant_id = ANY($1)`, [
      [org.realTenantId, org.twinTenantId],
    ]);
  });
});
