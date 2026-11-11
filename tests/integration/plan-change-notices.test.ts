import { randomUUID } from 'node:crypto';
import {
  addPlanModule,
  changePlan,
  createKeyCipher,
  createPlan,
  draftPrice,
  fixedClock,
  onboardOrganization,
  publishPrice,
  removePlanModule,
  resolveActor,
  setNotificationPreference,
  setPlanLimit,
  updatePlan,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { and, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

type Sent = { to: string; template: string; params: Record<string, string> };

// FR-BILL-6, ADR-011: what the platform changes under a paying company, with notice, is told to
// the company that holds it, in the same transaction as the change.
describe('plan change notices', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let org: CreatedOrganization;
  let other: CreatedOrganization;
  let ownerId: string;
  let planKey: string;
  const sent: Sent[] = [];
  const notice = {
    appUrl: 'https://app.test',
    jobs: {
      enqueue: (_tx: unknown, queue: string, data: unknown) => {
        if (queue === 'email.send') sent.push(data as Sent);
        return Promise.resolve(null);
      },
    },
  };
  const told = (tenantId: string, type: string) =>
    db.withSystem('test: read notifications', ({ db: tx }) =>
      tx
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.tenantId, tenantId),
            eq(schema.notifications.type, type as 'PRICE_RISE'),
          ),
        ),
    );
  const company = async (label: string) => {
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: label, email: `pc.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    const created = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: `${label} S.A.`,
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
      { keyCipher: createKeyCipher('c3'.repeat(32)), clock },
    );
    return { created, userId: user!.id };
  };

  beforeAll(async () => {
    db = appDatabase();
    operator = { ...(await superAdmin(db)), clock };
    planKey = `P_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    await createPlan(operator, db, {
      key: planKey,
      nameEs: 'Plan Prueba',
      nameEn: 'Test Plan',
      selfService: true,
    });
    await updatePlan(operator, db, {
      key: planKey,
      nameEs: 'Plan Prueba',
      nameEn: 'Test Plan',
      selfService: true,
      status: 'PUBLISHED',
    });
    const mine = await company('Rho');
    org = mine.created;
    ownerId = mine.userId;
    other = (await company('Pi')).created;
    await changePlan(operator, db, { realTenantId: org.realTenantId, planKey });
  });

  afterAll(() => db.close());

  it('tells a rise to the companies that pay for it, and not a cut or another plan', async () => {
    const first = await draftPrice(operator, db, { kind: 'PLAN', planKey, amount: '10.00' });
    await publishPrice(operator, db, { id: first.id, effectiveOn: '2026-11-10' }, notice);
    expect(await told(org.realTenantId, 'PRICE_RISE')).toHaveLength(0);

    const rise = await draftPrice(operator, db, { kind: 'PLAN', planKey, amount: '12.00' });
    await publishPrice(operator, db, { id: rise.id }, notice);
    const rows = await told(org.realTenantId, 'PRICE_RISE');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.params).toEqual({
      name: 'Plan Prueba',
      nameEn: 'Test Plan',
      date: '2026-12-10',
    });
    const email = sent.find((message) => message.template === 'priceRise');
    expect(email?.params).toMatchObject({ name: 'Plan Prueba' });
    expect(await told(other.realTenantId, 'PRICE_RISE')).toHaveLength(0);

    const cut = await draftPrice(operator, db, { kind: 'PLAN', planKey, amount: '8.00' });
    await publishPrice(operator, db, { id: cut.id, effectiveOn: '2026-11-15' }, notice);
    expect(await told(org.realTenantId, 'PRICE_RISE')).toHaveLength(1);

    // The notice a rise owes can't be switched off.
    const owner = await resolveActor(db, {
      userId: ownerId,
      tenantId: org.realTenantId,
      clock,
    });
    await expect(
      setNotificationPreference(owner, db, {
        type: 'PRICE_RISE',
        channel: 'EMAIL',
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_MANDATORY' });
  });

  it('tells a module leaving the plan, with its date', async () => {
    await addPlanModule(operator, db, { planKey, moduleKey: 'INVENTORY' });
    await removePlanModule(operator, db, { planKey, moduleKey: 'INVENTORY' }, notice);
    const rows = await told(org.realTenantId, 'PLAN_CONTENT_LEAVING');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.params).toMatchObject({ date: '2026-12-10' });
    expect(rows[0]!.params.name).toBeTruthy();
    expect(await told(other.realTenantId, 'PLAN_CONTENT_LEAVING')).toHaveLength(0);
  });

  it('tells a limit going down, and nothing for one going up', async () => {
    await setPlanLimit(operator, db, { planKey, featureKey: 'USERS', value: 10 }, notice);
    expect(await told(org.realTenantId, 'PLAN_LIMIT_LOWERING')).toHaveLength(0);
    await setPlanLimit(operator, db, { planKey, featureKey: 'USERS', value: 3 }, notice);
    const rows = await told(org.realTenantId, 'PLAN_LIMIT_LOWERING');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.params).toEqual({
      name: 'usuarios',
      nameEn: 'users',
      count: '3',
      date: '2026-12-10',
    });
    const email = sent.find((message) => message.template === 'planLimitLowering');
    expect(email?.params).toMatchObject({ count: '3', name: 'usuarios' });
  });
});
