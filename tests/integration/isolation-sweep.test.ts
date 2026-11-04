import { randomUUID } from 'node:crypto';
import {
  acceptAgreements,
  acceptInvitation,
  addModule,
  createClient,
  createProduct,
  createAuth,
  createJobs,
  createKeyCipher,
  createRateLimiter,
  createVerifiedUser,
  fixedClock,
  inviteMember,
  onboardOrganization,
  recordSessionStart,
  resolveActor,
  setIssuePointAccess,
  type CreatedOrganization,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import type { Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, grantSeats, superAdmin, testLogger } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const parties = {
  operator: {
    name: 'Operadora',
    ruc: '1712345678001',
    address: 'Quito',
    supportEmail: 'soporte@example.com',
  },
};

// Milestone 1 gate (NFR-SEC-1): every tenant table, found from the catalog rather than
// a list, holds rows for two companies and a twin, and no company sees another's.
describe('isolation sweep over every tenant table', () => {
  const clock = fixedClock(new Date().toISOString());
  let db: Database;
  let jobs: Jobs;
  let tables: string[];
  const orgs: CreatedOrganization[] = [];

  // A company with a row in every tenant table built so far.
  const populate = async (auth: ReturnType<typeof createAuth>) => {
    const email = `sw.${randomUUID()}@example.com`;
    const { id: owner } = await createVerifiedUser(auth, {
      name: 'Owner',
      email,
      password: 'correct horse battery',
      locale: 'es',
    });
    const ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: owner,
        ruc,
        legalName: `Sweep ${ruc}`,
        tradeName: null,
        mainAddress: 'Quito',
        branch: { code: '001', name: 'Matriz', address: null },
        issuePointCode: '001',
        certificate: { file: createTestP12({ ruc }), password: 'secret' },
        logo: PNG,
      },
      { keyCipher: createKeyCipher('e'.repeat(64)), clock },
    );
    await grantSeats(db, org);
    const ctx = await resolveActor(db, { userId: owner, tenantId: org.realTenantId, clock });
    const memberEmail = `swi.${randomUUID()}@example.com`;
    const invited = await createVerifiedUser(auth, {
      name: 'Invited',
      email: memberEmail,
      password: 'correct horse battery',
      locale: 'es',
    });
    await inviteMember(
      ctx,
      db,
      { email: memberEmail, role: 'SALES', locale: 'es' },
      {
        jobs,
        appUrl: 'http://app.test',
        rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      },
    );
    const token = await db.withSystem('test: read the invitation token', async ({ executeSql }) => {
      const { rows } = await executeSql<{ url: string }>(
        `SELECT data->'params'->>'url' AS url FROM pgboss.job WHERE name = 'email.send' AND data->>'to' = $1 ORDER BY created_on DESC LIMIT 1`,
        [memberEmail],
      );
      return new URL(rows[0]!.url).searchParams.get('token')!;
    });
    await acceptInvitation(db, { token, userId: invited.id, userEmail: memberEmail }, clock);
    await setIssuePointAccess(ctx, db, {
      userId: invited.id,
      points: [{ branchCode: '001', pointCode: '001' }],
    });
    // A second, still pending invitation keeps a row in invitations.
    await inviteMember(
      ctx,
      db,
      { email: `swp.${randomUUID()}@example.com`, role: 'VIEWER', locale: 'es' },
      {
        jobs,
        appUrl: 'http://app.test',
        rateLimiter: createRateLimiter(db.identity, () => clock.now()),
      },
    );
    // grantSeats wrote an override; an add-on fills subscription_items.
    await addModule(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      moduleKey: 'INVENTORY',
    });
    await acceptAgreements(ctx, db, { ipAddress: '203.0.113.9', userAgent: 'Sweep' }, parties);
    for (const tenantId of [org.realTenantId, org.twinTenantId]) {
      await recordSessionStart(db, { tenantId, userId: owner, sessionId: randomUUID() });
      // Clients and products: each tenant, the twin included, keeps its own (FR-MD-1, FR-MD-2).
      const actor = await resolveActor(db, { userId: owner, tenantId, clock });
      await createClient(actor, db, {
        idType: '05',
        identification: '1710034065',
        name: 'Cliente',
      });
      await createProduct(actor, db, {
        code: 'P-1',
        name: 'Producto',
        kind: 'GOOD',
        price: '1.00',
        ivaRateCode: '4',
      });
    }
    return org;
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const auth = createAuth({
      db: db.identity,
      secret: 'integration-test-secret-integration-test-secret',
      appUrl: 'http://app.test',
      emails: { verification: () => Promise.resolve(), passwordReset: () => Promise.resolve() },
    });
    orgs.push(await populate(auth), await populate(auth));
    tables = await db.withSystem(
      'test: list tenant tables from the catalog',
      async ({ executeSql }) => {
        const { rows } = await executeSql<{ name: string }>(
          `SELECT c.relname AS name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT LIKE 'probe\\_%'
         ORDER BY 1`,
        );
        return rows.map((row) => row.name);
      },
    );
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('finds the tenant tables built so far', () => {
    expect(tables).toEqual(
      expect.arrayContaining([
        'agreement_acceptances',
        'audit_events',
        'branches',
        'certificates',
        'clients',
        'document_sequences',
        'invitations',
        'issue_point_document_types',
        'issue_point_access',
        'issue_points',
        'memberships',
        'products',
        'subscription_items',
        'subscriptions',
        'tenant_feature_overrides',
        'tenant_logos',
        'warehouses',
      ]),
    );
  });

  it('has rows for every company in every tenant table', async () => {
    const empty: string[] = [];
    for (const table of tables) {
      for (const org of orgs) {
        const count = await db.withSystem(
          'test: count rows per company',
          async ({ executeSql }) => {
            const { rows } = await executeSql<{ n: number }>(
              `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = ANY($1)`,
              [[org.realTenantId, org.twinTenantId]],
            );
            return rows[0]!.n;
          },
        );
        if (count === 0) empty.push(table);
      }
    }
    // Otherwise the next test would pass for a table with nothing to hide.
    expect(empty).toEqual([]);
  });

  it('shows each company, and each twin, only its own rows in every tenant table', async () => {
    const leaks: string[] = [];
    const tenants = orgs.flatMap((org) => [org.realTenantId, org.twinTenantId]);
    for (const tenantId of tenants) {
      for (const table of tables) {
        const foreign = await db.withTenant({ tenantId }, async ({ executeSql }) => {
          const { rows } = await executeSql<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id <> $1`,
            [tenantId],
          );
          return rows[0]!.n;
        });
        if (foreign > 0) leaks.push(`${table} seen from ${tenantId}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
