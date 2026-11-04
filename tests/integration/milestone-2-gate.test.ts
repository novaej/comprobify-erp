import { randomUUID } from 'node:crypto';
import {
  addModule,
  clearOverride,
  companyLogo,
  createJobs,
  createOrganization,
  createRateLimiter,
  fixedClock,
  inviteMember,
  removeModule,
  requireFeature,
  resolveActor,
  setOverride,
  type CreatedOrganization,
  type Jobs,
  type PlatformActor,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

// Milestone 2 gate: switching a feature for one company changes what core lets it do,
// in the company and its twin, and leaves another company on the same plan alone.
// The screens' side is the last E2E test in tests/e2e/auth.spec.ts.
describe('Milestone 2 gate: a feature switched per company', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let jobs: Jobs;
  let operator: PlatformActor;
  let ownerId: string;
  let one: CreatedOrganization;
  let other: CreatedOrganization;

  const company = () =>
    createOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc: testRuc(),
        legalName: 'Nu S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        branch: { code: '001', name: 'Matriz', address: null },
        issuePointCode: '001',
      },
      { logo: { content: PNG, contentType: 'image/png' } },
    );
  const actor = (tenantId: string, at = '2026-11-10T16:00:00Z') =>
    resolveActor(db, { userId: ownerId, tenantId, clock: fixedClock(at) });
  const invite = async (org: CreatedOrganization) =>
    inviteMember(
      await actor(org.realTenantId),
      db,
      { email: `gate.${randomUUID()}@example.com`, role: 'SALES', locale: 'es' },
      {
        jobs,
        appUrl: 'http://app.test',
        rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      },
    );

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const [owner] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `gate.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = owner!.id;
    operator = { ...(await superAdmin(db)), clock };
    one = await company();
    other = await company();
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('starts both companies on Gratis, with the same features and limits', async () => {
    const [a, b] = await Promise.all([actor(one.realTenantId), actor(other.realTenantId)]);
    expect(a.entitlements).toEqual(b.entitlements);
    expect(() => requireFeature(a, 'INVENTORY')).toThrow(
      expect.objectContaining({ code: 'FEATURE_NOT_ENABLED' }),
    );
    await expect(invite(one)).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  });

  it('switches features and limits on for one company, in it and its twin only', async () => {
    const id = { realTenantId: one.realTenantId };
    await addModule(operator, db, { ...id, moduleKey: 'INVENTORY' });
    await setOverride(operator, db, {
      ...id,
      featureKey: 'RIDE_LOGO',
      effect: 'GRANT',
      limitValue: null,
      reason: 'gate',
    });
    await setOverride(operator, db, {
      ...id,
      featureKey: 'USERS',
      effect: 'LIMIT',
      limitValue: 3,
      reason: 'gate',
    });

    for (const tenantId of [one.realTenantId, one.twinTenantId]) {
      const ctx = await actor(tenantId);
      expect(() => requireFeature(ctx, 'INVENTORY')).not.toThrow();
      await expect(companyLogo(ctx, db)).resolves.toMatchObject({ contentType: 'image/png' });
    }
    await expect(invite(one)).resolves.toBeUndefined();

    const untouched = await actor(other.realTenantId);
    expect(() => requireFeature(untouched, 'INVENTORY')).toThrow(
      expect.objectContaining({ code: 'FEATURE_NOT_ENABLED' }),
    );
    await expect(companyLogo(untouched, db)).resolves.toBeNull();
    await expect(invite(other)).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  });

  it('switches them off again: an exception at once, an add-on at the next month', async () => {
    const id = { realTenantId: one.realTenantId };
    await clearOverride(operator, db, { ...id, featureKey: 'RIDE_LOGO' });
    await removeModule(operator, db, { ...id, moduleKey: 'INVENTORY' });

    const now = await actor(one.realTenantId);
    await expect(companyLogo(now, db)).resolves.toBeNull();
    // Removed on 10 November: kept for the rest of the month.
    expect(() => requireFeature(now, 'INVENTORY')).not.toThrow();
    const december = await actor(one.realTenantId, '2026-12-01T05:00:00Z');
    expect(() => requireFeature(december, 'INVENTORY')).toThrow(
      expect.objectContaining({ code: 'FEATURE_NOT_ENABLED' }),
    );
  });
});
