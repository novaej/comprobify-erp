import { randomUUID } from 'node:crypto';
import {
  addModule,
  changePlan,
  clearLimit,
  clearOverride,
  createOrganization,
  fixedClock,
  getCompany,
  listAuditEvents,
  listCompanies,
  removeModule,
  resolveActor,
  resolvePlatformActor,
  setBilling,
  setLimit,
  setNegotiatedPrice,
  setOverride,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase } from './helpers';

// ADR-010, ADR-011, FR-ADM-1, FR-PLAN-1a, FR-PLAN-1b.
describe('super admin: companies and their plans', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let ownerId: string;

  const newUser = async (isSuperAdmin = false) => {
    const [user] = await db.identity
      .insert(schema.users)
      .values({
        name: 'User',
        email: `pl.${randomUUID()}@example.com`,
        emailVerified: true,
        isSuperAdmin,
      })
      .returning({ id: schema.users.id });
    return user!.id;
  };

  const newCompany = (): Promise<CreatedOrganization & { ruc: string }> => {
    const ruc = testRuc();
    return createOrganization(db, {
      ownerUserId: ownerId,
      ruc,
      legalName: `Lambda ${ruc}`,
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    }).then((org) => ({ ...org, ruc }));
  };

  const entitlements = async (tenantId: string, at = clock.now().toISOString()) =>
    (await resolveActor(db, { userId: ownerId, tenantId, clock: fixedClock(at) })).entitlements;

  beforeAll(async () => {
    db = appDatabase();
    ownerId = await newUser();
    operator = await resolvePlatformActor(db.identity, { userId: await newUser(true), clock });
  });

  afterAll(() => db.close());

  it('lets only a super admin in, and stops one whose flag was revoked', async () => {
    await expect(
      resolvePlatformActor(db.identity, { userId: ownerId, clock }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const former = await resolvePlatformActor(db.identity, {
      userId: await newUser(true),
      clock,
    });
    await db.identity
      .update(schema.users)
      .set({ isSuperAdmin: false })
      .where(eq(schema.users.id, former.userId));
    await expect(listCompanies(former, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('finds a company by RUC with its plan, and refuses a twin as a company', async () => {
    const org = await newCompany();
    const [entry] = await listCompanies(operator, db, { query: org.ruc });
    expect(entry).toMatchObject({
      realTenantId: org.realTenantId,
      twinTenantId: org.twinTenantId,
      subscription: { planKey: 'FREE', billing: 'PAID' },
    });
    await expect(getCompany(operator, db, org.twinTenantId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('changes the plan in the company and its twin, and logs it in the company', async () => {
    const org = await newCompany();
    await changePlan(operator, db, { realTenantId: org.realTenantId, planKey: 'BUSINESS' });
    for (const tenantId of [org.realTenantId, org.twinTenantId])
      expect((await entitlements(tenantId)).features).toContain('INVENTORY');
    await expect(
      changePlan(operator, db, { realTenantId: org.realTenantId, planKey: 'BUSINESS' }),
    ).rejects.toMatchObject({ code: 'SAME_PLAN' });
    await expect(
      changePlan(operator, db, { realTenantId: org.realTenantId, planKey: 'API_500' }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_AVAILABLE' });
    const owner = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
    const [event] = await listAuditEvents(owner, db, { limit: 1 });
    expect(event).toMatchObject({
      action: 'subscription.plan_changed',
      details: { from: 'FREE', to: 'BUSINESS', planEs: 'Negocio' },
    });
  });

  it("sets Personalizado's limits and price, and drops both on leaving it", async () => {
    const org = await newCompany();
    const id = { realTenantId: org.realTenantId };
    await expect(
      setNegotiatedPrice(operator, db, { ...id, monthlyPrice: '99' }),
    ).rejects.toMatchObject({ code: 'NOT_CUSTOM_PLAN' });
    await changePlan(operator, db, { ...id, planKey: 'CUSTOM' });
    await setLimit(operator, db, { ...id, featureKey: 'USERS', value: 7 });
    await setLimit(operator, db, { ...id, featureKey: 'DOCUMENT_QUOTA', value: null });
    await setNegotiatedPrice(operator, db, { ...id, monthlyPrice: '149.90' });
    await expect(
      setNegotiatedPrice(operator, db, { ...id, monthlyPrice: '12.345' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect((await entitlements(org.twinTenantId)).limits).toMatchObject({
      USERS: 7,
      DOCUMENT_QUOTA: null,
    });
    expect((await getCompany(operator, db, org.realTenantId)).plan).toMatchObject({
      negotiatedMonthlyPrice: '149.90',
    });

    await clearLimit(operator, db, { ...id, featureKey: 'USERS' });
    expect((await entitlements(org.realTenantId)).limits.USERS).toBe(1);

    await changePlan(operator, db, { ...id, planKey: 'STARTER' });
    const view = await getCompany(operator, db, org.realTenantId);
    expect(view.plan).toMatchObject({ negotiatedMonthlyPrice: null, limits: [] });
    expect(view.plan.entitlements.limits.DOCUMENT_QUOTA).toBe(50);
  });

  it('adds only sellable modules, and removes one at the next Ecuador month', async () => {
    const org = await newCompany();
    const id = { realTenantId: org.realTenantId };
    for (const [moduleKey, code] of [
      ['DELIVERY_GUIDES', 'MODULE_NOT_AVAILABLE'],
      ['INVOICING', 'MODULE_NOT_AVAILABLE'],
      ['NOPE', 'MODULE_NOT_FOUND'],
    ] as const)
      await expect(addModule(operator, db, { ...id, moduleKey })).rejects.toMatchObject({ code });

    await addModule(operator, db, { ...id, moduleKey: 'INVENTORY' });
    await expect(addModule(operator, db, { ...id, moduleKey: 'INVENTORY' })).rejects.toMatchObject({
      code: 'MODULE_ALREADY_ADDED',
    });
    await removeModule(operator, db, { ...id, moduleKey: 'INVENTORY' });
    // Removed on 10 November: kept for the rest of the month, gone from December.
    expect((await entitlements(org.twinTenantId, '2026-11-30T23:00:00Z')).features).toContain(
      'INVENTORY',
    );
    expect((await entitlements(org.twinTenantId, '2026-12-01T05:00:00Z')).features).not.toContain(
      'INVENTORY',
    );
    // Adding it back before then cancels the removal.
    await addModule(operator, db, { ...id, moduleKey: 'INVENTORY' });
    expect((await entitlements(org.realTenantId, '2026-12-15T12:00:00Z')).features).toContain(
      'INVENTORY',
    );

    await changePlan(operator, db, { ...id, planKey: 'STARTER' });
    await expect(addModule(operator, db, { ...id, moduleKey: 'BRANDING' })).rejects.toMatchObject({
      code: 'MODULE_IN_PLAN',
    });
  });

  it('makes a company complimentary only with a reason', async () => {
    const org = await newCompany();
    const id = { realTenantId: org.realTenantId };
    await expect(
      setBilling(operator, db, { ...id, complimentary: true, reason: ' ' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await setBilling(operator, db, { ...id, complimentary: true, reason: 'Owner company' });
    expect((await getCompany(operator, db, org.realTenantId)).plan).toMatchObject({
      billing: 'COMPLIMENTARY',
      complimentaryReason: 'Owner company',
    });
    await setBilling(operator, db, { ...id, complimentary: false });
    expect((await getCompany(operator, db, org.realTenantId)).plan).toMatchObject({
      billing: 'PAID',
      complimentaryReason: null,
    });
  });

  it('replaces an override for the same key, refuses a mismatched one, and clears it', async () => {
    const org = await newCompany();
    const id = { realTenantId: org.realTenantId };
    const override = (
      featureKey: string,
      effect: 'GRANT' | 'REVOKE' | 'LIMIT',
      value: number | null,
    ) =>
      setOverride(operator, db, { ...id, featureKey, effect, limitValue: value, reason: 'test' });
    await expect(override('USERS', 'GRANT', null)).rejects.toMatchObject({
      code: 'INVALID_OVERRIDE',
    });
    await override('RIDE_LOGO', 'GRANT', null);
    await override('RIDE_LOGO', 'REVOKE', null);
    expect((await getCompany(operator, db, org.realTenantId)).plan.overrides).toMatchObject([
      { featureKey: 'RIDE_LOGO', effect: 'REVOKE' },
    ]);
    await clearOverride(operator, db, { ...id, featureKey: 'RIDE_LOGO' });
    await expect(
      clearOverride(operator, db, { ...id, featureKey: 'RIDE_LOGO' }),
    ).rejects.toMatchObject({ code: 'OVERRIDE_NOT_FOUND' });
  });
});
