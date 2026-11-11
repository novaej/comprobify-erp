import { randomUUID } from 'node:crypto';
import {
  billingOverview,
  buyAddOn,
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  resolveActor,
  reviewPayment,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin, testNotice } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// FR-BILL-1, FR-BILL-7: what the billing page offers, at today's placeholder prices.
describe('the billing overview', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let ownerId: string;
  const owner = (): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `bo.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Phi S.A.',
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
      { keyCipher: createKeyCipher('d8'.repeat(32)), clock },
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('offers the paid plans, the add-ons outside the plan, the seat and the packs', async () => {
    const view = await billingOverview(await owner(), db);
    expect(view.subscription).toMatchObject({
      billing: 'PAID',
      planKey: 'FREE',
      periodEnd: null,
      extraSeats: 0,
    });
    // Gratis is never bought: it is where cancelling leads.
    const starting = view.plans.filter((plan) =>
      ['FREE', 'STARTER', 'BUSINESS', 'ENTERPRISE'].includes(plan.key),
    );
    expect(starting.map((plan) => [plan.key, plan.monthly, plan.yearly])).toEqual([
      ['STARTER', '9.90', '99.00'],
      ['BUSINESS', '29.90', '299.00'],
      ['ENTERPRISE', '79.90', '799.00'],
    ]);
    expect(view.addOns.every((addOn) => addOn.state === 'AVAILABLE')).toBe(true);
    expect(view.seatMonthly).toBe('4.00');
    expect(view.packs.filter((pack) => [100, 500, 2000].includes(pack.size))).toEqual([
      { size: 100, price: '5.00' },
      { size: 500, price: '20.00' },
      { size: 2000, price: '60.00' },
    ]);
    expect(view).toMatchObject({ packsLeft: 0, payments: [] });
  });

  it('shows a bought add-on, the plan paid for and its payments', async () => {
    const operator = { ...(await superAdmin(db)), clock };
    const pay = async (id: string) => {
      await submitProof(
        await owner(),
        db,
        {
          paymentId: id,
          reference: 'SPI-1',
          files: [{ filename: 'p.png', content: PNG }],
        },
        testNotice,
      );
      await reviewPayment(operator, db, { paymentId: id, decision: 'VERIFIED' }, testNotice);
    };
    const initial = await startPaidPlan(await owner(), db, {
      planKey: 'STARTER',
      interval: 'MONTHLY',
    });
    await pay(initial.id);
    const addOn = await buyAddOn(await owner(), db, { moduleKey: 'DELIVERY_GUIDES' });
    await pay(addOn.applied === 'NOW' ? addOn.payment!.id : '');

    const view = await billingOverview(await owner(), db);
    expect(view.subscription).toMatchObject({ planKey: 'STARTER', periodEnd: '2026-12-10' });
    expect(view.addOns.find((row) => row.key === 'DELIVERY_GUIDES')).toMatchObject({
      state: 'ACTIVE',
      monthly: '5.00',
    });
    // Emprende includes credit notes, so they aren't offered on top.
    expect(view.addOns.map((row) => row.key)).not.toContain('CREDIT_NOTES');
    expect(view.payments.map((payment) => [payment.purpose, payment.status])).toEqual([
      ['ADD_ON', 'VERIFIED'],
      ['INITIAL', 'VERIFIED'],
    ]);
    expect(view.payments[0]!.targetModule).toMatchObject({ key: 'DELIVERY_GUIDES' });
  });
});
