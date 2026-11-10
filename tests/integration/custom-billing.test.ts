import { randomUUID } from 'node:crypto';
import {
  addModule,
  applyDueRenewal,
  buyAddOn,
  changePlan,
  createKeyCipher,
  fixedClock,
  moveToCustom,
  onboardOrganization,
  openRenewal,
  requestPlanChange,
  resolveActor,
  reviewPayment,
  setAddOnComplimentary,
  setLimit,
  setNegotiatedPrice,
  startCustomBilling,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// ADR-035: Personalizado billed at its negotiated price, a paying company moving to it, and
// add-ons the operator gives without charge. Placeholders: Negocio 29.90, Guías 5.00.
describe('Personalizado billing and complimentary add-ons', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let sent: { to: string; template: string; params: Record<string, string> }[] = [];
  const notice = {
    appUrl: 'https://app.test',
    jobs: {
      enqueue: (_tx: unknown, queue: string, data: unknown) => {
        if (queue === 'email.send') sent.push(data as (typeof sent)[number]);
        return Promise.resolve(null);
      },
    },
  };

  type Company = { org: CreatedOrganization; ownerId: string; email: string };
  const owner = (company: Company): Promise<ActorContext> =>
    resolveActor(db, { userId: company.ownerId, tenantId: company.org.twinTenantId, clock });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: custom billing', ({ executeSql }) => executeSql(text, values));
  const subscription = async (company: Company) =>
    (
      await sql(
        `SELECT p.key AS plan, s.period_start::text AS start, s.period_end::text AS "end",
                pp.key AS pending
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         LEFT JOIN plans pp ON pp.id = s.pending_plan_id WHERE s.tenant_id = $1`,
        [company.org.realTenantId],
      )
    ).rows[0];
  const pay = async (company: Company, paymentId: string) => {
    await submitProof(await owner(company), db, {
      paymentId,
      reference: 'SPI-1',
      files: [{ filename: 'p.png', content: PNG }],
    });
    await reviewPayment({ ...operator, clock }, db, { paymentId, decision: 'VERIFIED' });
  };
  const renewalOf = async (company: Company, at: string) => {
    const row = await db.withSystem('test: open the renewal', ({ db: tx }) =>
      openRenewal(tx, company.org.realTenantId, new Date(at)),
    );
    return row!;
  };
  const roll = (company: Company, at: string) =>
    db.withSystem('test: the day the period starts', ({ db: tx }) =>
      applyDueRenewal(tx, company.org.realTenantId, new Date(at)),
    );

  const newCompany = async (name: string): Promise<Company> => {
    const email = `cb.${randomUUID()}@example.com`;
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: name,
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
      { keyCipher: createKeyCipher('dd'.repeat(32)), clock },
    );
    return { org, ownerId: user!.id, email };
  };

  beforeAll(async () => {
    db = appDatabase();
    operator = { ...(await superAdmin(db)), clock };
  });

  afterAll(async () => {
    await db.close();
  });

  it('bills Personalizado at its negotiated price, renews at it, and tells the payer of a new one', async () => {
    const company = await newCompany('Custom Uno S.A.');
    const id = { realTenantId: company.org.realTenantId };
    await changePlan(operator, db, { ...id, planKey: 'CUSTOM' });
    expect(await failure(startCustomBilling(operator, db, { ...id, interval: 'MONTHLY' }))).toBe(
      'NO_NEGOTIATED_PRICE',
    );
    await setNegotiatedPrice(operator, db, { ...id, monthlyPrice: '120.00' }, notice);
    // The modules are the deal: one the operator adds is never charged on top.
    await addModule(operator, db, { ...id, moduleKey: 'DELIVERY_GUIDES' });
    await setLimit(operator, db, { ...id, featureKey: 'USERS', value: 8 });
    const first = await startCustomBilling(operator, db, { ...id, interval: 'MONTHLY' });
    expect(first).toMatchObject({
      purpose: 'INITIAL',
      baseAmount: '120.00',
      ivaAmount: '18.00',
      totalAmount: '138.00',
    });
    await pay(company, first.id);
    expect(await subscription(company)).toMatchObject({
      plan: 'CUSTOM',
      start: '2026-11-10',
      end: '2026-12-10',
    });
    // The company changes nothing of it itself.
    expect(
      await failure(
        requestPlanChange(await owner(company), db, { planKey: 'BUSINESS', interval: 'MONTHLY' }),
      ),
    ).toBe('CUSTOM_PLAN_MANAGED');
    expect(await failure(buyAddOn(await owner(company), db, { moduleKey: 'INVENTORY' }))).toBe(
      'CUSTOM_PLAN_MANAGED',
    );

    const renewal = await renewalOf(company, '2026-12-03T15:00:00Z');
    expect(renewal).toMatchObject({ baseAmount: '120.00', totalAmount: '138.00' });
    sent = [];
    await setNegotiatedPrice(operator, db, { ...id, monthlyPrice: '100.00' }, notice);
    const { rows } = await sql(
      `SELECT status, base_amount FROM payments WHERE tenant_id = $1 AND purpose = 'RENEWAL'
       ORDER BY created_at`,
      [id.realTenantId],
    );
    expect(rows).toEqual([
      { status: 'CANCELLED', base_amount: '120.00' },
      { status: 'PENDING', base_amount: '100.00' },
    ]);
    expect(sent.find((email) => email.to === company.email)).toMatchObject({
      template: 'renewalRepriced',
      params: { amount: '$115.00' },
    });
  });

  it('moves a paying company to a dearer Personalizado now, the difference prorated', async () => {
    const company = await newCompany('Custom Dos S.A.');
    const id = { realTenantId: company.org.realTenantId };
    const initial = await startPaidPlan(await owner(company), db, {
      planKey: 'BUSINESS',
      interval: 'MONTHLY',
    });
    await pay(company, initial.id);
    clock.set('2026-11-25T15:00:00Z');
    // (59.90 - 29.90) × 15 of 30 days = 15.00, plus 2.25 of IVA.
    const moved = await moveToCustom(operator, db, { ...id, monthlyPrice: '59.90' }, notice);
    expect(moved).toMatchObject({
      when: 'NOW',
      payment: { purpose: 'TIER_CHANGE', baseAmount: '15.00', totalAmount: '17.25' },
    });
    expect(await subscription(company)).toMatchObject({ plan: 'BUSINESS' });
    if (moved.when === 'NOW') await pay(company, moved.payment.id);
    expect(await subscription(company)).toMatchObject({
      plan: 'CUSTOM',
      start: '2026-11-10',
      end: '2026-12-10',
    });
    clock.set('2026-11-10T15:00:00Z');
  });

  it('keeps a cheaper Personalizado for the period end, with what it brings starting then', async () => {
    const company = await newCompany('Custom Tres S.A.');
    const id = { realTenantId: company.org.realTenantId };
    const initial = await startPaidPlan(await owner(company), db, {
      planKey: 'BUSINESS',
      interval: 'MONTHLY',
    });
    await pay(company, initial.id);
    await expect(
      moveToCustom(operator, db, { ...id, monthlyPrice: '19.90' }, notice),
    ).resolves.toEqual({ when: 'PERIOD_END', effectiveOn: '2026-12-10' });
    // Until then: Negocio, and the company can't undo the operator's move.
    expect(await subscription(company)).toMatchObject({ plan: 'BUSINESS', pending: 'CUSTOM' });
    expect(
      await failure(
        requestPlanChange(await owner(company), db, { planKey: 'STARTER', interval: 'MONTHLY' }),
      ),
    ).toBe('CUSTOM_PLAN_MANAGED');
    // Set now for Personalizado, it starts with it: no Guías, and Negocio's users, until then.
    await addModule(operator, db, { ...id, moduleKey: 'DELIVERY_GUIDES' });
    await setLimit(operator, db, { ...id, featureKey: 'USERS', value: 9 });
    let ctx = await owner(company);
    expect(ctx.entitlements.features).not.toContain('DOC_TYPE_06');
    expect(ctx.entitlements.features).toContain('INVENTORY');
    expect(ctx.entitlements.limits.USERS).toBe(5);

    // The renewal charges the negotiated price, paid ahead, applied on the day.
    const renewal = await renewalOf(company, '2026-12-03T15:00:00Z');
    expect(renewal).toMatchObject({ baseAmount: '19.90' });
    clock.set('2026-12-05T15:00:00Z');
    await pay(company, renewal.id);
    expect(await subscription(company)).toMatchObject({ plan: 'BUSINESS', end: '2026-12-10' });
    await expect(roll(company, '2026-12-10T11:00:00Z')).resolves.toBe(true);
    expect(await subscription(company)).toMatchObject({
      plan: 'CUSTOM',
      start: '2026-12-10',
      end: '2027-01-10',
      pending: null,
    });
    clock.set('2026-12-10T15:00:00Z');
    ctx = await owner(company);
    expect(ctx.entitlements.features).toContain('DOC_TYPE_06');
    expect(ctx.entitlements.features).not.toContain('INVENTORY');
    expect(ctx.entitlements.limits.USERS).toBe(9);
    clock.set('2026-11-10T15:00:00Z');
  });

  it('never charges a complimentary add-on, and charges it again once taken back', async () => {
    const company = await newCompany('Cortesía S.A.');
    const id = { realTenantId: company.org.realTenantId };
    await addModule(operator, db, {
      ...id,
      moduleKey: 'DELIVERY_GUIDES',
      complimentaryReason: 'Cliente fundador',
    });
    // Negocio 29.90; Guías given.
    const initial = await startPaidPlan(await owner(company), db, {
      planKey: 'BUSINESS',
      interval: 'MONTHLY',
    });
    expect(initial).toMatchObject({ baseAmount: '29.90' });
    await pay(company, initial.id);
    expect((await renewalOf(company, '2026-12-03T15:00:00Z')).baseAmount).toBe('29.90');
    await sql(
      `UPDATE payments SET status = 'CANCELLED', cancelled_at = now()
       WHERE tenant_id = $1 AND purpose = 'RENEWAL' AND status = 'PENDING'`,
      [id.realTenantId],
    );
    await setAddOnComplimentary(operator, db, {
      ...id,
      moduleKey: 'DELIVERY_GUIDES',
      reason: null,
    });
    expect((await renewalOf(company, '2026-12-03T15:00:00Z')).baseAmount).toBe('34.90');
    await expect(
      setAddOnComplimentary(operator, db, { ...id, moduleKey: 'INVENTORY', reason: 'x'.repeat(5) }),
    ).rejects.toMatchObject({ code: 'MODULE_NOT_ADDED' });
  });
});
