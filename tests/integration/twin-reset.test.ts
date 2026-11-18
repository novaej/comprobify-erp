import { randomUUID } from 'node:crypto';
import {
  companySettings,
  createClient,
  createInvoice,
  createJobs,
  createKeyCipher,
  createProduct,
  fixedClock,
  listAuditEvents,
  listProducts,
  onboardOrganization,
  resetTwin,
  resolveActor,
  type ActorContext,
  type CreatedOrganization,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, testLogger } from './helpers';

// PRD glossary "Twin reset", FR-ONB-5, ADR-043.
describe('resetting the test copy', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('e'.repeat(64));
  let db: Database;
  let jobs: Jobs;
  let org: CreatedOrganization;
  let ruc: string;
  let ownerId: string;
  let real: ActorContext;
  let twin: ActorContext;

  const invoice = async (ctx: ActorContext) => {
    const point = (await companySettings(ctx, db)).branches[0]!.issuePoints[0]!.id;
    return createInvoice(
      ctx,
      db,
      {
        issuePointId: point,
        clientId: null,
        lines: [{ code: 'P-1', name: 'Café', quantity: '1', unitPrice: '10', ivaRateCode: '4' }],
        payments: [{ method: '01', amount: '11.50' }],
      },
      { jobs, keyCipher, appEnv: 'local', providerRuc: null, consumerFinalMaxAmount: '50.00' },
    );
  };
  const count = (table: typeof schema.documents | typeof schema.clients, tenantId: string) =>
    db.withTenant(
      { tenantId },
      async ({ db: tx }) =>
        (await tx.select({ id: table.id }).from(table).where(eq(table.tenantId, tenantId))).length,
    );

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `tr.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Reset S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2027-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher, clock },
    );
    real = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
    twin = await resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('asks for the RUC, and refuses a role without the permission', async () => {
    await expect(resetTwin(twin, db, { confirmation: 'yes' })).rejects.toMatchObject({
      code: 'CONFIRMATION_MISMATCH',
    });
    const viewer = { ...twin, permissions: ['documents.read'] } as unknown as ActorContext;
    await expect(resetTwin(viewer, db, { confirmation: ruc })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('empties the test copy, refills it from the company, and leaves the company alone', async () => {
    await createProduct(real, db, {
      code: 'REAL-1',
      name: 'Producto real',
      kind: 'SERVICE',
      price: '3',
      ivaRateCode: '4',
    });
    await createProduct(twin, db, {
      code: 'TEST-1',
      name: 'Producto de prueba',
      kind: 'SERVICE',
      price: '1',
      ivaRateCode: '4',
    });
    await createClient(twin, db, {
      idType: '05',
      identification: '1710034065',
      name: 'Cliente de prueba',
      emails: [],
    });
    await invoice(twin);
    const second = await invoice(twin);
    expect(second.number.endsWith('000000002')).toBe(true);

    // From the real company too: it resets the pair's test copy.
    const { copied } = await resetTwin(real, db, { confirmation: ` ${ruc} ` });
    expect(copied).toMatchObject({ products: 1, clients: 0 });
    expect(await count(schema.documents, org.twinTenantId)).toBe(0);
    expect(await count(schema.clients, org.twinTenantId)).toBe(0);
    expect((await listProducts(twin, db)).map((product) => product.code)).toEqual(['REAL-1']);
    expect((await listProducts(real, db)).map((product) => product.code)).toEqual(['REAL-1']);
    // Numbering starts again, on the branches and issue points it kept.
    expect((await invoice(twin)).number.endsWith('000000001')).toBe(true);
    expect((await listAuditEvents(real, db)).map((event) => event.action)).toContain(
      'organization.twin_reset',
    );
  });

  it('is refused by the database for a real company, and outside system context', async () => {
    await expect(
      db.withSystem('test: reset a real company', ({ executeSql }) =>
        executeSql('SELECT app_reset_twin($1)', [org.realTenantId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.withTenant({ tenantId: org.twinTenantId }, ({ executeSql }) =>
        executeSql('SELECT app_reset_twin($1)', [org.twinTenantId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
