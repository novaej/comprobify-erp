import { randomUUID } from 'node:crypto';
import { createDatabase, type Database } from '@comprobify/db';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, asOwner, createProbe, probeName, testLogger } from './helpers';

// NFR-SEC-1, NFR-SEC-2, NFR-SEC-4, ADR-004.
describe('tenant isolation', () => {
  const table = probeName('isolation');
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const noContext = { code: '42501', message: 'RLS: no tenant or system context' };
  let db: Database;

  const labels = async (tenantId: string): Promise<string[]> =>
    db.withTenant({ tenantId }, async (tx) => {
      const { rows } = await tx.executeSql<{ label: string }>(
        `SELECT label FROM ${table} ORDER BY label`,
      );
      return rows.map((row) => row.label);
    });

  beforeAll(async () => {
    await asOwner((owner) => createProbe(owner, table, true));
    db = appDatabase();
    for (const [tenantId, label] of [
      [tenantA, 'a'],
      [tenantB, 'b'],
    ] as const) {
      await db.withTenant({ tenantId }, (tx) =>
        tx.executeSql(`INSERT INTO ${table} (tenant_id, label) VALUES ($1, $2)`, [tenantId, label]),
      );
    }
  });

  afterAll(async () => {
    await db.close();
    await asOwner((owner) => owner.query(`DROP TABLE public.${table}`));
  });

  it('shows a tenant only its own rows', async () => {
    await expect(labels(tenantA)).resolves.toEqual(['a']);
    await expect(labels(tenantB)).resolves.toEqual(['b']);
  });

  it('refuses a write for another tenant', async () => {
    await expect(
      db.withTenant({ tenantId: tenantA }, (tx) =>
        tx.executeSql(`INSERT INTO ${table} (tenant_id, label) VALUES ($1, 'x')`, [tenantB]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot update another tenant into view', async () => {
    const updated = await db.withTenant({ tenantId: tenantA }, async (tx) => {
      const { rows } = await tx.executeSql(
        `UPDATE ${table} SET label = 'stolen' WHERE tenant_id = $1 RETURNING id`,
        [tenantB],
      );
      return rows.length;
    });
    expect(updated).toBe(0);
  });

  it('raises when a connection has no context', async () => {
    const bare = new Client({ connectionString: appUrl });
    await bare.connect();
    try {
      await expect(bare.query(`SELECT * FROM ${table}`)).rejects.toMatchObject(noContext);
    } finally {
      await bare.end();
    }
  });

  it('applies forced RLS to the owner too (lesson 20)', async () => {
    await asOwner(async (owner) => {
      await expect(owner.query(`SELECT * FROM ${table}`)).rejects.toMatchObject(noContext);
    });
  });

  it('lets system context see every tenant, and logs the reason', async () => {
    const logger = testLogger();
    const system = createDatabase({ connectionString: appUrl, logger });
    try {
      const count = await system.withSystem('isolation test', async (tx) => {
        const { rows } = await tx.executeSql<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${table}`,
        );
        return rows[0]?.count;
      });
      expect(count).toBe(2);
      expect(logger.info).toHaveBeenCalledWith('System context', {
        event: 'db.system_context',
        reason: 'isolation test',
      });
    } finally {
      await system.close();
    }
  });

  it('does not leak context to the next user of a pooled connection', async () => {
    const single = appDatabase(1);
    try {
      await single.withSystem('leak test', (tx) => tx.executeSql('SELECT 1'));
      await expect(
        single.withTenant({ tenantId: tenantA }, async (tx) => {
          const { rows } = await tx.executeSql(`SELECT 1 FROM ${table}`);
          return rows.length;
        }),
      ).resolves.toBe(1);

      await single.withTenant({ tenantId: tenantA }, () => Promise.resolve());
      const { rows } = await single.withTenant({ tenantId: tenantB }, (tx) =>
        tx.executeSql<{ label: string }>(`SELECT label FROM ${table}`),
      );
      expect(rows).toEqual([{ label: 'b' }]);
    } finally {
      await single.close();
    }
  });

  it('rolls back when the callback throws', async () => {
    await expect(
      db.withTenant({ tenantId: tenantA }, async (tx) => {
        await tx.executeSql(`INSERT INTO ${table} (tenant_id, label) VALUES ($1, 'gone')`, [
          tenantA,
        ]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(labels(tenantA)).resolves.toEqual(['a']);
  });

  it('generates ids with native uuidv7', async () => {
    const version = await db.withTenant({ tenantId: tenantA }, async (tx) => {
      const { rows } = await tx.executeSql<{ version: number }>(
        `SELECT uuid_extract_version(id) AS version FROM ${table}`,
      );
      return rows[0]?.version;
    });
    expect(version).toBe(7);
  });

  describe('app role rights', () => {
    it('has no DELETE', async () => {
      await expect(
        db.withTenant({ tenantId: tenantA }, (tx) => tx.executeSql(`DELETE FROM ${table}`)),
      ).rejects.toThrow(/permission denied/);
    });

    it('has no DDL', async () => {
      await expect(
        db.withTenant({ tenantId: tenantA }, (tx) =>
          tx.executeSql('CREATE TABLE public.nope (a int)'),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('cannot run app_enable_tenant_rls', async () => {
      await expect(
        db.withSystem('rights test', (tx) =>
          tx.executeSql(`SELECT app_enable_tenant_rls('${table}'::regclass)`),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('passes the boot guard', async () => {
      await expect(db.assertSafeConnection()).resolves.toBeUndefined();
    });
  });
});
