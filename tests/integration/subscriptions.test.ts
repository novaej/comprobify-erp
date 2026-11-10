import { randomUUID } from 'node:crypto';
import { assignDefaultPlans, createOrganization, type CreatedOrganization } from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, asOwner, ownerDatabase } from './helpers';

// ADR-011, FR-PLAN-1a, FR-PLAN-1b, FR-ONB-6a.
describe('subscriptions', () => {
  let db: Database;
  let owner: Database;
  let org: CreatedOrganization;
  let userId: string;

  const planOf = (tenantId: string) =>
    db.withTenant({ tenantId }, async ({ db: tx }) => {
      const rows = await tx
        .select({ plan: schema.plans.key, billing: schema.subscriptions.billing })
        .from(schema.subscriptions)
        .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId));
      return rows;
    });

  const write = (text: string, values: unknown[] = []) =>
    db.withSystem('test: break the subscription rules', ({ executeSql }) =>
      executeSql(text, values),
    );

  beforeAll(async () => {
    db = appDatabase();
    owner = ownerDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `sub.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    userId = user!.id;
    org = await createOrganization(db, {
      ownerUserId: userId,
      ruc: testRuc(),
      legalName: 'Iota S.A.',
      tradeName: null,
      mainAddress: 'Cuenca',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
  });

  afterAll(async () => {
    await db.close();
    await owner.close();
  });

  it('starts a new company and its twin on Gratis, each reading its own row', async () => {
    await expect(planOf(org.realTenantId)).resolves.toEqual([{ plan: 'FREE', billing: 'PAID' }]);
    await expect(planOf(org.twinTenantId)).resolves.toEqual([{ plan: 'FREE', billing: 'PAID' }]);
  });

  it('puts a company without a plan on Gratis, and leaves the others alone', async () => {
    await asOwner(async (client) => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.rls_system = 'on'`);
      await client.query('DELETE FROM subscriptions WHERE tenant_id = ANY($1)', [
        [org.realTenantId, org.twinTenantId],
      ]);
      await client.query('COMMIT');
    });
    await expect(planOf(org.twinTenantId)).resolves.toEqual([]);
    await expect(assignDefaultPlans(owner)).resolves.toBe(2);
    await expect(assignDefaultPlans(owner)).resolves.toBe(0);
    await expect(planOf(org.realTenantId)).resolves.toEqual([{ plan: 'FREE', billing: 'PAID' }]);
  });

  it('allows one subscription per tenant, and complimentary only with a reason', async () => {
    await expect(
      write(
        `INSERT INTO subscriptions (tenant_id, plan_id, period_start)
         SELECT $1, id, '2026-11-10' FROM plans WHERE key = 'CUSTOM'`,
        [org.realTenantId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      write(`UPDATE subscriptions SET billing = 'COMPLIMENTARY' WHERE tenant_id = $1`, [
        org.realTenantId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await write(
      `UPDATE subscriptions SET billing = 'COMPLIMENTARY', complimentary_reason = 'Owner company'
       WHERE tenant_id = $1`,
      [org.realTenantId],
    );
    await expect(planOf(org.realTenantId)).resolves.toEqual([
      { plan: 'FREE', billing: 'COMPLIMENTARY' },
    ]);
  });

  it('keeps items to a module or a limit key, one active of each per subscription', async () => {
    const item = (columns: string, select: string) =>
      write(
        `INSERT INTO subscription_items (tenant_id, subscription_id, ${columns})
         SELECT s.tenant_id, s.id, ${select} FROM subscriptions s WHERE s.tenant_id = $1`,
        [org.realTenantId],
      );
    const inventory = `(SELECT id FROM modules WHERE key = 'INVENTORY')`;
    await item('kind, module_id', `'MODULE', ${inventory}`);
    await expect(item('kind, module_id', `'MODULE', ${inventory}`)).rejects.toMatchObject({
      code: '23505',
    });
    await item('kind, feature_key, limit_value', `'LIMIT', 'USERS', 8`);
    // A boolean key isn't a limit, and a module item carries no key.
    await expect(
      item('kind, feature_key, limit_value', `'LIMIT', 'INVENTORY', 1`),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      item(
        'kind, module_id, feature_key',
        `'MODULE', (SELECT id FROM modules WHERE key = 'CREDIT_NOTES'), 'USERS'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('matches an override to its key: grant or revoke a boolean, set a limit', async () => {
    const override = (key: string, kind: string, effect: string, value: number | null) =>
      write(
        `INSERT INTO tenant_feature_overrides
           (tenant_id, feature_key, feature_kind, effect, limit_value, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, 'test', $6)`,
        [org.realTenantId, key, kind, effect, value, userId],
      );
    await override('RIDE_LOGO', 'BOOLEAN', 'GRANT', null);
    await override('USERS', 'LIMIT', 'LIMIT', null);
    await expect(override('RIDE_LOGO', 'BOOLEAN', 'REVOKE', null)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(override('DOCUMENT_QUOTA', 'LIMIT', 'GRANT', null)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(override('MAX_BRANCHES', 'BOOLEAN', 'GRANT', null)).rejects.toMatchObject({
      code: '23503',
    });
  });
});
