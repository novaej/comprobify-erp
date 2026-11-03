import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  companyLogo,
  companyUsage,
  createJobs,
  createOrganization,
  createRateLimiter,
  fixedClock,
  inviteMember,
  planOverview,
  resolveActor,
  type CreatedOrganization,
  type Jobs,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, grantSeats, testLogger } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

// ADR-011, FR-PLAN-1, FR-PLAN-3, FR-PLAN-4, FR-USR-1.
describe('entitlements', () => {
  const clock = fixedClock(new Date().toISOString());
  let db: Database;
  let jobs: Jobs;

  const newUser = async () => {
    const email = `ent.${randomUUID()}@example.com`;
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'User', email, emailVerified: true })
      .returning({ id: schema.users.id });
    return { id: user!.id, email };
  };

  const newCompany = async (ownerUserId: string): Promise<CreatedOrganization> =>
    createOrganization(
      db,
      {
        ownerUserId,
        ruc: testRuc(),
        legalName: 'Kappa S.A.',
        tradeName: null,
        mainAddress: 'Manta',
        branch: { code: '001', name: 'Matriz', address: null },
        issuePointCode: '001',
      },
      { logo: { content: PNG, contentType: 'image/png' } },
    );

  // Direct rows until the super admin functions exist (Milestone 2, step 5).
  const system = (text: string, values: unknown[]) =>
    db.withSystem('test: change what a company has', ({ executeSql }) => executeSql(text, values));
  const addModule = (org: CreatedOrganization, key: string) =>
    Promise.all(
      [org.realTenantId, org.twinTenantId].map((tenantId) =>
        system(
          `INSERT INTO subscription_items (tenant_id, subscription_id, kind, module_id)
           SELECT $1, s.id, 'MODULE', m.id FROM subscriptions s, modules m
           WHERE s.tenant_id = $1 AND m.key = $2`,
          [tenantId, key],
        ),
      ),
    );

  const deps = () => ({
    jobs,
    appUrl: 'http://app.test',
    rateLimiter: createRateLimiter(db.identity, () => clock.now()),
  });
  const tokenFor = (email: string) =>
    db.withSystem('test: read the queued invitation email', async ({ executeSql }) => {
      const { rows } = await executeSql<{ url: string }>(
        `SELECT data->'params'->>'url' AS url FROM pgboss.job
         WHERE name = 'email.send' AND data->>'to' = $1 ORDER BY created_on DESC LIMIT 1`,
        [email],
      );
      return new URL(rows[0]!.url).searchParams.get('token')!;
    });

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('resolves Gratis into the actor, the same in the company and its twin', async () => {
    const owner = await newUser();
    const org = await newCompany(owner.id);
    for (const tenantId of [org.realTenantId, org.twinTenantId]) {
      const ctx = await resolveActor(db, { userId: owner.id, tenantId, clock });
      expect(ctx.entitlements.features).toEqual(
        expect.arrayContaining(['DOC_TYPE_01', 'CATALOG', 'CLIENTS']),
      );
      expect(ctx.entitlements.features).not.toContain('RIDE_LOGO');
      expect(ctx.entitlements.limits).toMatchObject({ USERS: 1, DOCUMENT_QUOTA: 5 });
    }
  });

  it('prints the logo only while the company has Marca, and keeps it stored either way', async () => {
    const owner = await newUser();
    const org = await newCompany(owner.id);
    const ctx = () => resolveActor(db, { userId: owner.id, tenantId: org.realTenantId, clock });
    await expect(companyLogo(await ctx(), db)).resolves.toBeNull();
    await addModule(org, 'BRANDING');
    await expect(companyLogo(await ctx(), db)).resolves.toMatchObject({
      contentType: 'image/png',
    });
  });

  it('lets an override take a plan feature away', async () => {
    const owner = await newUser();
    const org = await newCompany(owner.id);
    await system(
      `INSERT INTO tenant_feature_overrides
         (tenant_id, feature_key, feature_kind, effect, reason, created_by)
       VALUES ($1, 'CLIENTS', 'BOOLEAN', 'REVOKE', 'test', $2)`,
      [org.realTenantId, owner.id],
    );
    const real = await resolveActor(db, { userId: owner.id, tenantId: org.realTenantId, clock });
    expect(real.entitlements.features).not.toContain('CLIENTS');
  });

  it('counts members and pending invitations against USERS', async () => {
    const owner = await newUser();
    const org = await newCompany(owner.id);
    const ctx = () => resolveActor(db, { userId: owner.id, tenantId: org.realTenantId, clock });
    const invite = async (email: string) =>
      inviteMember(await ctx(), db, { email, role: 'SALES', locale: 'es' }, deps());

    // Gratis: the owner is the only seat.
    await expect(invite(`full.${randomUUID()}@example.com`)).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
      details: { feature: 'USERS', limit: 1 },
    });

    await grantSeats(db, org, owner.id, 2);
    const first = await newUser();
    await invite(first.email);
    // The pending invitation holds the second seat, but re-sending it doesn't take a third.
    await invite(first.email);
    await expect(invite(`third.${randomUUID()}@example.com`)).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
    });

    // Fewer seats now than when it was sent: accepting is refused.
    await system(`UPDATE tenant_feature_overrides SET limit_value = 1 WHERE tenant_id = ANY($1)`, [
      [org.realTenantId, org.twinTenantId],
    ]);
    const token = await tokenFor(first.email);
    await expect(
      acceptInvitation(db, { token, userId: first.id, userEmail: first.email }, clock),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  });

  it('shows the plan, its modules and add-ons, and the limits as resolved', async () => {
    const owner = await newUser();
    const org = await newCompany(owner.id);
    await addModule(org, 'BRANDING');
    const ctx = await resolveActor(db, { userId: owner.id, tenantId: org.twinTenantId, clock });
    const overview = await planOverview(ctx, db);
    expect(overview).toMatchObject({
      plan: { key: 'FREE', nameEs: 'Gratis', selfService: true },
      billing: 'PAID',
      limits: { DOCUMENT_QUOTA: 5, USERS: 1, MAX_BRANCHES: 1, MAX_ISSUE_POINTS_PER_BRANCH: 1 },
    });
    expect(overview.modules.map((module) => [module.key, module.source])).toEqual([
      ['INVOICING', 'PLAN'],
      ['BRANDING', 'ADD_ON'],
    ]);
  });

  it('counts usage in the real company, from the twin too, for whoever may see it', async () => {
    const owner = await newUser();
    const org = await newCompany(owner.id);
    await grantSeats(db, org, owner.id, 5);
    const real = await resolveActor(db, { userId: owner.id, tenantId: org.realTenantId, clock });
    await inviteMember(
      real,
      db,
      { email: `use.${randomUUID()}@example.com`, role: 'SALES', locale: 'es' },
      deps(),
    );
    const twin = await resolveActor(db, { userId: owner.id, tenantId: org.twinTenantId, clock });
    await expect(companyUsage(twin, db)).resolves.toEqual({
      USERS: 2,
      MAX_BRANCHES: 1,
      MAX_ISSUE_POINTS_PER_BRANCH: 1,
    });
    const viewer = {
      ...real,
      permissions: real.permissions.filter((p) => p !== 'billing.read' && p !== 'users.read'),
    };
    await expect(companyUsage(viewer, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(planOverview(viewer, db)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
