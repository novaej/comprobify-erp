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

export type IdentityDb = NodePgDatabase<typeof schema>;

export type Database = {
  withTenant: <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  withSystem: <T>(reason: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  // Identity lookups only: the user's own memberships and organizations (ADR-010).
  withUser: <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  // The one exception to NFR-SEC-2 (ADR-009): Better Auth and the rate limiter use
  // it for the global identity tables only. It sets no context, so a tenant table
  // reached through it raises.
  identity: IdentityDb;
  assertSafeConnection: () => Promise<void>;
  // Touches no tables, so it needs no context. For health checks.
  ping: () => Promise<void>;
  close: () => Promise<void>;
};

export type DatabaseOptions = {
  connectionString: string;
  logger: Logger;
  maxConnections?: number;
};

const uuid = z.uuid();

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
      if (!uuid.safeParse(ctx.tenantId).success) throw new Error('Invalid tenant id');
      return inTransaction(
        pool,
        (client) => client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantId]),
        fn,
      );
    },

    async withUser(userId, fn) {
      if (!uuid.safeParse(userId).success) throw new Error('Invalid user id');
      return inTransaction(
        pool,
        (client) => client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]),
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

    identity: drizzle({ client: pool, schema }),
    assertSafeConnection: () => assertSafeConnection(pool),
    ping: async () => {
      await pool.query('SELECT 1');
    },
    close: () => pool.end(),
  };
}

type Settings = { tenant: string; user: string; system: string };
const NO_CONTEXT: Settings = { tenant: '', user: '', system: '' };

// ADR-049: a whole run in one transaction, for one-off operator work such as the legacy import.
// Every context call is a savepoint inside it with that call's settings only, so core workflows
// compose unchanged; nothing is kept unless `commit` is true, which makes a dry run the default.
export async function inOneTransaction<T>(
  options: DatabaseOptions & { commit: boolean },
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: options.connectionString, max: 1 });
  const client = await pool.connect();
  let current = NO_CONTEXT;
  let savepoints = 0;
  const apply = (settings: Settings) =>
    client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true),
        set_config('app.rls_system', $3, true)`,
      [settings.tenant, settings.user, settings.system],
    );
  const handle: Tx = {
    db: drizzle({ client, schema }),
    executeSql: (text, values) => client.query(text, values),
  };
  const scoped = async <R>(settings: Settings, run: (tx: Tx) => Promise<R>): Promise<R> => {
    const name = `ctx_${++savepoints}`;
    const outer = current;
    await client.query(`SAVEPOINT ${name}`);
    current = settings;
    await apply(settings);
    try {
      const result = await run(handle);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw error;
    } finally {
      // A released savepoint keeps its settings; the caller's come back.
      current = outer;
      await apply(outer);
    }
  };
  const db: Database = {
    withTenant: (ctx, run) => {
      if (!uuid.safeParse(ctx.tenantId).success) throw new Error('Invalid tenant id');
      return scoped({ ...NO_CONTEXT, tenant: ctx.tenantId }, run);
    },
    withUser: (userId, run) => {
      if (!uuid.safeParse(userId).success) throw new Error('Invalid user id');
      return scoped({ ...NO_CONTEXT, user: userId }, run);
    },
    withSystem: (reason, run) => {
      if (!reason.trim()) throw new Error('System context needs a reason');
      options.logger.info('System context', { event: 'db.system_context', reason });
      return scoped({ ...NO_CONTEXT, system: 'on' }, run);
    },
    identity: handle.db,
    assertSafeConnection: () => assertSafeConnection(client),
    ping: async () => {
      await client.query('SELECT 1');
    },
    // The run's own end closes it.
    close: () => Promise.resolve(),
  };
  try {
    await client.query('BEGIN');
    const result = await fn(db);
    await client.query(options.commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
