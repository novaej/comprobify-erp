import type { Logger } from '@comprobify/config/logger';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { z } from 'zod';
import { assertSafeConnection } from './boot-guard';
import * as schema from './schema';

export type TenantContext = { tenantId: string };

export type Tx = {
  db: NodePgDatabase<typeof schema>;
  // Same connection as db. Also the pg-boss IDatabase shape (ADR-003).
  executeSql: <Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Row[] }>;
};

export type Database = {
  withTenant: <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  withSystem: <T>(reason: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  assertSafeConnection: () => Promise<void>;
  close: () => Promise<void>;
};

export type DatabaseOptions = {
  connectionString: string;
  logger: Logger;
  maxConnections?: number;
};

const tenantId = z.uuid();

async function inTransaction<T>(
  pool: Pool,
  setContext: (client: PoolClient) => Promise<unknown>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await setContext(client);
    const result = await fn({
      db: drizzle({ client, schema }),
      executeSql: (text, values) => client.query(text, values),
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // A client that can't roll back must not return to the pool.
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

// NFR-SEC-2: the only ways to reach the database.
export function createDatabase(options: DatabaseOptions): Database {
  const { connectionString, logger, maxConnections } = options;
  const pool = new Pool({ connectionString, max: maxConnections });
  pool.on('error', (err) => logger.error('Idle database client failed', { err }));

  return {
    async withTenant(ctx, fn) {
      if (!tenantId.safeParse(ctx.tenantId).success) throw new Error('Invalid tenant id');
      return inTransaction(
        pool,
        (client) => client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantId]),
        fn,
      );
    },

    async withSystem(reason, fn) {
      if (!reason.trim()) throw new Error('System context needs a reason');
      logger.info('System context', { event: 'db.system_context', reason });
      return inTransaction(
        pool,
        (client) => client.query(`SELECT set_config('app.rls_system', 'on', true)`),
        fn,
      );
    },

    assertSafeConnection: () => assertSafeConnection(pool),
    close: () => pool.end(),
  };
}
