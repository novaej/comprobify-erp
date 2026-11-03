import { randomUUID } from 'node:crypto';
import { FEATURE_KEYS, STARTING_MODULES, STARTING_PLANS, syncCatalog } from '@comprobify/core';
import { eq, schema, type Database, type Tx } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, ownerDatabase } from './helpers';

// ADR-011, FR-PLAN-1, FR-PLAN-2. Global setup has already synced the catalog once.
describe('plan catalog', () => {
  let db: Database;
  let owner: Database;

  beforeAll(() => {
    db = appDatabase();
    owner = ownerDatabase();
  });

  afterAll(async () => {
    await db.close();
    await owner.close();
  });

  const inTenant = <T>(fn: (tx: Tx) => Promise<T>) => db.withTenant({ tenantId: randomUUID() }, fn);

  it('holds every feature key, starting module and plan, readable from a tenant', async () => {
    const rows = await inTenant(async ({ db: tx }) => [
      (await tx.select({ key: schema.features.key }).from(schema.features)).map((r) => r.key),
      (await tx.select({ key: schema.modules.key }).from(schema.modules)).map((r) => r.key),
      (await tx.select({ key: schema.plans.key }).from(schema.plans)).map((r) => r.key),
    ]);
    expect(rows[0]).toEqual(expect.arrayContaining(FEATURE_KEYS));
    expect(rows[1]).toEqual(expect.arrayContaining(STARTING_MODULES.map((m) => m.key)));
    expect(rows[2]).toEqual(expect.arrayContaining(STARTING_PLANS.map((p) => p.key)));
  });

  it('adds nothing on a second sync, and keeps what the super admin edited', async () => {
    await owner.withSystem('test: edit a plan name', ({ db: tx }) =>
      tx.update(schema.plans).set({ nameEs: 'Gratis editado' }).where(eq(schema.plans.key, 'FREE')),
    );
    await expect(syncCatalog(owner)).resolves.toEqual({ features: [], modules: [], plans: [] });
    const [free] = await inTenant(({ db: tx }) =>
      tx
        .select({ nameEs: schema.plans.nameEs })
        .from(schema.plans)
        .where(eq(schema.plans.key, 'FREE')),
    );
    expect(free?.nameEs).toBe('Gratis editado');
    await owner.withSystem('test: restore a plan name', ({ db: tx }) =>
      tx.update(schema.plans).set({ nameEs: 'Gratis' }).where(eq(schema.plans.key, 'FREE')),
    );
  });

  it('refuses catalog writes outside system context', async () => {
    await expect(
      inTenant(({ executeSql }) => executeSql(`UPDATE plans SET name_es = 'x'`)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inTenant(({ executeSql }) =>
        executeSql(
          `INSERT INTO plans (key, name_es, name_en, status, self_service, sort_order)
           VALUES ('ROGUE', 'x', 'x', 'PUBLISHED', true, 99)`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('leaves feature keys to the migrate step, even in system context', async () => {
    await expect(
      db.withSystem('test: add a feature key', ({ executeSql }) =>
        executeSql(`INSERT INTO features (key, kind) VALUES ('ROGUE', 'BOOLEAN')`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses a limit key in a module, a boolean key as a plan limit, and a second base', async () => {
    const write = (text: string) =>
      db.withSystem('test: break the catalog rules', ({ executeSql }) => executeSql(text));
    await expect(
      write(
        `INSERT INTO module_features (module_id, feature_key)
         SELECT id, 'USERS' FROM modules WHERE key = 'CREDIT_NOTES'`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      write(
        `INSERT INTO plan_limits (plan_id, feature_key, value)
         SELECT id, 'INVENTORY', 1 FROM plans WHERE key = 'FREE'`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      write(`UPDATE modules SET is_base = true WHERE key = 'CREDIT_NOTES'`),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
