import { randomUUID } from 'node:crypto';
import {
  addModuleFeature,
  addPlanModule,
  changePlan,
  createModule,
  createOrganization,
  createPlan,
  fixedClock,
  getCatalog,
  removeModuleFeature,
  removePlanModule,
  resolveActor,
  resolvePlatformActor,
  setPlanLimit,
  updateModule,
  updatePlan,
  type PlatformActor,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, testNotice } from './helpers';

// ADR-011, FR-ADM-3: editing modules and plans, with 30 days' notice for what a
// company loses. Each test makes its own keys, so the shared catalog stays as seeded.
describe('super admin: plan and module editors', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let ownerId: string;
  const unique = () => randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();

  const catalog = () => getCatalog(operator, db);
  const plan = async (key: string) => (await catalog()).plans.find((row) => row.key === key)!;
  const module = async (key: string) => (await catalog()).modules.find((row) => row.key === key)!;

  // A company on the plan, and what it has on a given day.
  const companyOn = async (planKey: string) => {
    const org = await createOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc: testRuc(),
        legalName: 'Mu S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        branch: { code: '001', name: 'Matriz', address: null },
        issuePointCode: '001',
      },
      { clock },
    );
    await changePlan(operator, db, { realTenantId: org.realTenantId, planKey });
    return async (at: string) =>
      (
        await resolveActor(db, {
          userId: ownerId,
          tenantId: org.twinTenantId,
          clock: fixedClock(at),
        })
      ).entitlements;
  };

  beforeAll(async () => {
    db = appDatabase();
    const users = await db.identity
      .insert(schema.users)
      .values([
        { name: 'Owner', email: `ce.${randomUUID()}@example.com`, emailVerified: true },
        {
          name: 'Operator',
          email: `ceo.${randomUUID()}@example.com`,
          emailVerified: true,
          isSuperAdmin: true,
        },
      ])
      .returning({ id: schema.users.id });
    ownerId = users[0]!.id;
    operator = await resolvePlatformActor(db.identity, { userId: users[1]!.id, clock });
  });

  afterAll(() => db.close());

  it('creates a plan as a draft with the base module and the default limits', async () => {
    const key = `P_${unique()}`;
    await createPlan(operator, db, { key, nameEs: 'Prueba', nameEn: 'Test', selfService: true });
    expect(await plan(key)).toMatchObject({
      status: 'DRAFT',
      modules: [{ key: 'INVOICING', removesAt: null }],
    });
    expect((await plan(key)).limits).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'USERS', value: 1 })]),
    );
    await expect(
      createPlan(operator, db, { key, nameEs: 'x', nameEn: 'x', selfService: true }),
    ).rejects.toMatchObject({ code: 'KEY_TAKEN' });
    await expect(
      removePlanModule(operator, db, { planKey: key, moduleKey: 'INVOICING' }, testNotice),
    ).rejects.toMatchObject({ code: 'BASE_MODULE_REQUIRED' });
  });

  it('moves plan and module status only forward', async () => {
    const planKey = `P_${unique()}`;
    await createPlan(operator, db, { key: planKey, nameEs: 'A', nameEn: 'A', selfService: true });
    const update = (status: string) =>
      updatePlan(operator, db, {
        key: planKey,
        nameEs: 'A',
        nameEn: 'A',
        selfService: true,
        status,
      });
    await update('PUBLISHED');
    await expect(update('DRAFT')).rejects.toMatchObject({ code: 'STATUS_BACKWARD' });
    await update('RETIRED');
    await update('PUBLISHED');

    const moduleKey = `M_${unique()}`;
    await createModule(operator, db, { key: moduleKey, nameEs: 'B', nameEn: 'B' });
    expect((await module(moduleKey)).status).toBe('COMING_SOON');
    const set = (status: string) =>
      updateModule(operator, db, { key: moduleKey, nameEs: 'B', nameEn: 'B', status });
    await set('AVAILABLE');
    await expect(set('COMING_SOON')).rejects.toMatchObject({ code: 'STATUS_BACKWARD' });
  });

  it('gives companies an added module at once, and takes a removed one 30 days later', async () => {
    const planKey = `P_${unique()}`;
    await createPlan(operator, db, { key: planKey, nameEs: 'C', nameEn: 'C', selfService: true });
    await updatePlan(operator, db, {
      key: planKey,
      nameEs: 'C',
      nameEn: 'C',
      selfService: true,
      status: 'PUBLISHED',
    });
    const has = await companyOn(planKey);
    await addPlanModule(operator, db, { planKey, moduleKey: 'INVENTORY' });
    expect((await has('2026-11-10T16:00:00Z')).features).toContain('INVENTORY');

    await removePlanModule(operator, db, { planKey, moduleKey: 'INVENTORY' }, testNotice);
    // Removed on 10 November, dated 10 December at 10:00: the company's period that began that
    // morning still has it, and the one from 10 January doesn't (ADR-028).
    expect((await plan(planKey)).modules).toContainEqual({
      key: 'INVENTORY',
      removesAt: new Date('2026-12-10T15:00:00Z'),
    });
    expect((await has('2026-12-20T12:00:00Z')).features).toContain('INVENTORY');
    expect((await has('2027-01-11T12:00:00Z')).features).not.toContain('INVENTORY');
  });

  it('removes a key from a coming-soon module at once, and from an available one with notice', async () => {
    const moduleKey = `M_${unique()}`;
    await createModule(operator, db, { key: moduleKey, nameEs: 'D', nameEn: 'D' });
    await addModuleFeature(operator, db, { moduleKey, featureKey: 'RECEIVABLES' });
    await expect(
      addModuleFeature(operator, db, { moduleKey, featureKey: 'USERS' }),
    ).rejects.toMatchObject({ code: 'NOT_A_FEATURE' });
    await removeModuleFeature(operator, db, { moduleKey, featureKey: 'RECEIVABLES' }, testNotice);
    expect((await module(moduleKey)).features).toEqual([
      { key: 'RECEIVABLES', removesAt: clock.now() },
    ]);

    await addModuleFeature(operator, db, { moduleKey, featureKey: 'RECEIVABLES' });
    await updateModule(operator, db, {
      key: moduleKey,
      nameEs: 'D',
      nameEn: 'D',
      status: 'AVAILABLE',
    });
    await removeModuleFeature(operator, db, { moduleKey, featureKey: 'RECEIVABLES' }, testNotice);
    expect((await module(moduleKey)).features[0]!.removesAt).toEqual(
      new Date('2026-12-10T15:00:00Z'),
    );
  });

  it('raises a limit at once, and lowers it from the company’s first period 30 days on', async () => {
    const planKey = `P_${unique()}`;
    await createPlan(operator, db, { key: planKey, nameEs: 'E', nameEn: 'E', selfService: true });
    // A draft has no companies, so lowering is immediate.
    await setPlanLimit(operator, db, { planKey, featureKey: 'USERS', value: 0 }, testNotice);
    await setPlanLimit(operator, db, { planKey, featureKey: 'USERS', value: 10 }, testNotice);
    await updatePlan(operator, db, {
      key: planKey,
      nameEs: 'E',
      nameEn: 'E',
      selfService: true,
      status: 'PUBLISHED',
    });
    const has = await companyOn(planKey);

    await setPlanLimit(operator, db, { planKey, featureKey: 'USERS', value: 3 }, testNotice);
    expect((await plan(planKey)).limits).toContainEqual({
      key: 'USERS',
      value: 10,
      pendingValue: 3,
      pendingFrom: new Date('2026-12-10T15:00:00Z'),
    });
    expect((await has('2026-12-20T12:00:00Z')).limits.USERS).toBe(10);
    expect((await has('2027-01-11T12:00:00Z')).limits.USERS).toBe(3);

    // Raising again cancels the lowering.
    await setPlanLimit(operator, db, { planKey, featureKey: 'USERS', value: null }, testNotice);
    expect((await has('2027-01-11T12:00:00Z')).limits.USERS).toBeNull();
  });

  it('records every change in the platform log, which nobody can rewrite', async () => {
    const key = `M_${unique()}`;
    await createModule(operator, db, { key, nameEs: 'F', nameEn: 'F' });
    const rows = await db.withSystem('test: read the platform log', ({ executeSql }) =>
      executeSql<{ action: string; details: { module: string } }>(
        `SELECT action, details FROM platform_audit_events WHERE details->>'module' = $1`,
        [key],
      ),
    );
    expect(rows.rows).toEqual([{ action: 'module.created', details: { module: key } }]);
    await expect(
      db.withSystem('test: rewrite the platform log', ({ executeSql }) =>
        executeSql(`UPDATE platform_audit_events SET action = 'plan.created'`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
