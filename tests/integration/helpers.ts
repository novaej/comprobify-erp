import { randomUUID } from 'node:crypto';
import { loadTestEnv } from '@comprobify/config/env';
import type { Logger } from '@comprobify/config/logger';
import {
  accessKey,
  randomNumericCode,
  resolvePlatformActor,
  setOverride,
  takeSequential,
  systemClock,
  type PlatformActor,
} from '@comprobify/core';
import { createDatabase, eq, schema, type Database } from '@comprobify/db';
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

// A signed document straight in the tables, for tests that need one in a tenant without
// a certificate or go-live. Same sequence and access key code as createInvoice.
export async function insertTestDocument(
  db: Database,
  tenantId: string,
  options: { issueDate?: string } = {},
): Promise<{ id: string; accessKey: string; sequential: number }> {
  return db.withSystem('test: insert a signed document', async ({ db: tx }) => {
    const [point] = await tx
      .select({ id: schema.issuePoints.id, ruc: schema.tenants.ruc })
      .from(schema.issuePoints)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.issuePoints.tenantId))
      .where(eq(schema.issuePoints.tenantId, tenantId))
      .limit(1);
    const sequential = await takeSequential(tx, {
      tenantId,
      issuePointId: point!.id,
      documentType: '01',
    });
    const key = accessKey({
      issueDate: options.issueDate ?? '2026-11-10',
      documentType: '01',
      ruc: point!.ruc,
      ambiente: '1',
      series: '001001',
      sequential,
      numericCode: randomNumericCode(),
    });
    const [document] = await tx
      .insert(schema.documents)
      .values({
        tenantId,
        issuePointId: point!.id,
        documentType: '01',
        series: '001001',
        sequential,
        ambiente: '1',
        accessKey: key,
        issueDate: options.issueDate ?? '2026-11-10',
        buyerIdType: '07',
        buyerIdentification: '9999999999999',
        buyerName: 'CONSUMIDOR FINAL',
        subtotal: '10.00',
        discount: '0.00',
        taxTotals: [{ taxCode: '2', rateCode: '4', percent: '15', base: '10.00', value: '1.50' }],
        total: '11.50',
      })
      .returning({ id: schema.documents.id });
    await tx.insert(schema.documentLines).values({
      tenantId,
      documentId: document!.id,
      revision: 1,
      position: 1,
      code: 'P-1',
      name: 'Producto',
      quantity: '1',
      unitPrice: '10',
      discount: '0',
      ivaRateCode: '4',
      ivaPercent: '15',
      base: '10.00',
      iva: '1.50',
    });
    await tx.insert(schema.documentPayments).values({
      tenantId,
      documentId: document!.id,
      revision: 1,
      position: 1,
      method: '01',
      amount: '11.50',
    });
    await tx.insert(schema.documentEvents).values({
      tenantId,
      documentId: document!.id,
      type: 'CREATED',
      toStatus: 'SIGNED',
    });
    return { id: document!.id, accessKey: key, sequential };
  });
}
