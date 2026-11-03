import { randomUUID } from 'node:crypto';
import { loadTestEnv } from '@comprobify/config/env';
import type { Logger } from '@comprobify/config/logger';
import { createDatabase, type Database } from '@comprobify/db';
import { Client } from 'pg';
import { vi } from 'vitest';

const env = loadTestEnv();

export const appUrl = env.TEST_DATABASE_URL;

export function testLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return logger;
}

export function appDatabase(maxConnections?: number): Database {
  return createDatabase({
    connectionString: env.TEST_DATABASE_URL,
    logger: testLogger(),
    ...(maxConnections ? { maxConnections } : {}),
  });
}

// Owner session, for what the app role must not be able to do itself.
export async function asOwner<T>(fn: (owner: Client) => Promise<T>): Promise<T> {
  const owner = new Client({ connectionString: env.TEST_MIGRATION_DATABASE_URL });
  await owner.connect();
  try {
    return await fn(owner);
  } finally {
    await owner.end();
  }
}

export const probeName = (label: string): string =>
  `probe_${label}_${randomUUID().replaceAll('-', '')}`;

// Identifiers can't be parameters; probeName only produces [a-z0-9_].
export async function createProbe(owner: Client, name: string, protect: boolean): Promise<void> {
  await owner.query(
    `CREATE TABLE public.${name} (
       id uuid PRIMARY KEY DEFAULT uuidv7(),
       tenant_id uuid NOT NULL,
       label text NOT NULL
     )`,
  );
  if (protect) await owner.query(`SELECT app_enable_tenant_rls('public.${name}'::regclass)`);
}

// Owner-role Database, for steps the migrate step does, such as publishing legal texts.
export function ownerDatabase(): Database {
  return createDatabase({
    connectionString: env.TEST_MIGRATION_DATABASE_URL,
    logger: testLogger(),
  });
}

// Gratis allows one user. Until the super admin functions exist (Milestone 2, step 5),
// a test company gets more seats from an override written here, in it and its twin.
export async function grantSeats(
  db: Database,
  org: { realTenantId: string; twinTenantId: string },
  createdBy: string,
  seats = 20,
): Promise<void> {
  await db.withSystem('test: give a company more seats', async ({ executeSql }) => {
    for (const tenantId of [org.realTenantId, org.twinTenantId])
      await executeSql(
        `INSERT INTO tenant_feature_overrides
           (tenant_id, feature_key, feature_kind, effect, limit_value, reason, created_by)
         VALUES ($1, 'USERS', 'LIMIT', 'LIMIT', $2, 'test seats', $3)`,
        [tenantId, seats, createdBy],
      );
  });
}
