import { randomUUID } from 'node:crypto';
import {
  createOrganization,
  createProvider,
  fixedClock,
  listProviders,
  resolveActor,
  setOverride,
  setProviderActive,
  updateProvider,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-MD-3: providers, in the client's identity shape.
describe('providers', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let owner: ActorContext;

  const provider = (identification: string, idType = '04') => ({
    idType,
    identification,
    name: 'Distribuidora Andina S.A.',
    emails: ['Compras@Andina.ec'],
    paymentTerm: 30,
    paymentTermUnit: 'dias' as const,
  });

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `pv.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: 'Omicron S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    owner = await resolveActor(db, { userId: user!.id, tenantId: org.realTenantId, clock });
  });

  afterAll(() => db.close());

  it('needs the Proveedores feature, which the starting plan lacks', async () => {
    await expect(createProvider(owner, db, provider('1790012345001'))).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENABLED',
    });
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'PROVIDERS',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    owner = await resolveActor(db, { userId: owner.userId!, tenantId: org.realTenantId, clock });
  });

  it('validates the identification, keeps one per identification and its payment term', async () => {
    const created = await createProvider(owner, db, provider('1790012345001'));
    expect(created).toMatchObject({
      idType: '04',
      emails: ['compras@andina.ec'],
      paymentTerm: 30,
      paymentTermUnit: 'dias',
      active: true,
    });
    await expect(createProvider(owner, db, provider('1710034066', '05'))).rejects.toMatchObject({
      name: 'ZodError',
    });
    await expect(createProvider(owner, db, provider('1790012345001'))).rejects.toMatchObject({
      code: 'IDENTIFICATION_TAKEN',
    });
    const updated = await updateProvider(owner, db, created.id, {
      ...provider('1790012345001'),
      name: 'Andina Cía. Ltda.',
      paymentTerm: null,
      paymentTermUnit: null,
    });
    expect(updated).toMatchObject({ name: 'Andina Cía. Ltda.', paymentTerm: null });
  });

  it('keeps inactive providers out of the list by default, and each tenant to its own', async () => {
    const created = await createProvider(owner, db, provider('0102030400', '05'));
    await setProviderActive(owner, db, { id: created.id, active: false });
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    expect(ids(await listProviders(owner, db))).not.toContain(created.id);
    expect(ids(await listProviders(owner, db, { includeInactive: true }))).toContain(created.id);
    const twin = await resolveActor(db, {
      userId: owner.userId!,
      tenantId: org.twinTenantId,
      clock,
    });
    expect(await listProviders(twin, db, { includeInactive: true })).toEqual([]);
  });
});
