import { findUnprotectedTables, UnsafeDatabaseError, type Database } from '@comprobify/db';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, asOwner, createProbe, probeName } from './helpers';

// NFR-SEC-5, ADR-004: runs as the app role, against real probe tables.
describe('RLS catalog', () => {
  let db: Database;
  const created: string[] = [];

  const catalog = () =>
    db.withSystem('rls catalog test', (tx) => findUnprotectedTables({ query: tx.executeSql }));

  const withProbe = async (
    label: string,
    protect: boolean,
    change?: (owner: Client, name: string) => Promise<unknown>,
  ): Promise<string> => {
    const name = probeName(label);
    await asOwner(async (owner) => {
      await createProbe(owner, name, protect);
      created.push(name);
      await change?.(owner, name);
    });
    return `public.${name}`;
  };

  beforeAll(() => {
    db = appDatabase();
  });

  afterEach(async () => {
    await asOwner(async (owner) => {
      for (const name of created.splice(0)) await owner.query(`DROP TABLE public.${name}`);
    });
  });

  afterAll(() => db.close());

  it('passes on the migrated schema', async () => {
    await expect(catalog()).resolves.toEqual([]);
  });

  it('accepts a table protected by app_enable_tenant_rls', async () => {
    await withProbe('ok', true);
    await expect(catalog()).resolves.toEqual([]);
  });

  it('reports a tenant table with no RLS', async () => {
    const table = await withProbe('bare', false);
    await expect(catalog()).resolves.toEqual([
      `${table}: RLS is not enabled`,
      `${table}: RLS is not forced`,
      `${table}: standard policy is missing`,
    ]);
  });

  it('reports RLS that is enabled but not forced', async () => {
    const table = await withProbe('unforced', true, (owner, name) =>
      owner.query(`ALTER TABLE public.${name} NO FORCE ROW LEVEL SECURITY`),
    );
    await expect(catalog()).resolves.toEqual([`${table}: RLS is not forced`]);
  });

  it('reports a policy that differs from the standard one', async () => {
    const table = await withProbe('weak', true, async (owner, name) => {
      await owner.query(`DROP POLICY tenant_isolation ON public.${name}`);
      await owner.query(`CREATE POLICY tenant_isolation ON public.${name} USING (true)`);
    });
    await expect(catalog()).resolves.toEqual([`${table}: standard policy is missing`]);
  });

  it('reports an extra permissive policy', async () => {
    const table = await withProbe('widened', true, (owner, name) =>
      owner.query(`CREATE POLICY open_door ON public.${name} USING (true)`),
    );
    await expect(catalog()).resolves.toEqual([`${table}: extra permissive policy`]);
  });

  it('makes the boot guard refuse an unprotected table', async () => {
    await expect(db.assertSafeConnection()).resolves.toBeUndefined();
    await withProbe('guard', false);
    await expect(db.assertSafeConnection()).rejects.toBeInstanceOf(UnsafeDatabaseError);
  });
});
