import { randomUUID } from 'node:crypto';
import { loadTestEnv } from '@comprobify/config/env';
import type { Logger } from '@comprobify/config/logger';
import {
  resolvePlatformActor,
  setOverride,
  systemClock,
  type PlatformActor,
} from '@comprobify/core';
import { createDatabase, schema, type Database } from '@comprobify/db';
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

// A super admin, as the operator script makes one (ADR-010).
export async function superAdmin(db: Database): Promise<PlatformActor> {
  const [user] = await db.identity
    .insert(schema.users)
    .values({
      name: 'Operator',
      email: `op.${randomUUID()}@example.com`,
      emailVerified: true,
      isSuperAdmin: true,
    })
    .returning({ id: schema.users.id });
  return resolvePlatformActor(db.identity, { userId: user!.id, clock: systemClock });
}

// Gratis allows one user: a test company gets more through the operator's override.
export async function grantSeats(
  db: Database,
  org: { realTenantId: string },
  seats = 20,
): Promise<void> {
  await setOverride(await superAdmin(db), db, {
    realTenantId: org.realTenantId,
    featureKey: 'USERS',
    effect: 'LIMIT',
    limitValue: seats,
    reason: 'test seats',
  });
}
