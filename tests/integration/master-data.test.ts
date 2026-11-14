import { randomUUID } from 'node:crypto';
import {
  createClient,
  createOrganization,
  createProduct,
  fixedClock,
  listClients,
  listProducts,
  resolveActor,
  setClientActive,
  setOverride,
  updateProduct,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-MD-1, FR-MD-2, ADR-012.
describe('clients and products', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let owner: ActorContext;
  let ownerId: string;

  const client = (identification: string, idType = '05') => ({
    idType,
    identification,
    name: 'María López',
    emails: ['Maria@Example.com'],
  });
  const product = (code: string) => ({
    code,
    name: 'Servicio de consultoría',
    kind: 'SERVICE' as const,
    price: '25.123456',
    ivaRateCode: '4',
  });

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `md.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    org = await createOrganization(db, {
      ownerUserId: ownerId,
      ruc: testRuc(),
      legalName: 'Xi S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    owner = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
  });

  afterAll(() => db.close());

  it('validates a client by identification type and keeps one per identification', async () => {
    const created = await createClient(owner, db, client('1710034065'));
    expect(created).toMatchObject({ idType: '05', emails: ['maria@example.com'], active: true });
    await expect(createClient(owner, db, client('1710034066'))).rejects.toMatchObject({
      name: 'ZodError',
    });
    await expect(createClient(owner, db, client('9999999999999', '04'))).rejects.toMatchObject({
      name: 'ZodError',
    });
    await expect(createClient(owner, db, client('1710034065'))).rejects.toMatchObject({
      code: 'IDENTIFICATION_TAKEN',
    });
  });

  it('keeps inactive clients out of the list by default, and each tenant to its own', async () => {
    const created = await createClient(owner, db, client('0102030400'));
    await setClientActive(owner, db, { id: created.id, active: false });
    expect((await listClients(owner, db)).map((row) => row.id)).not.toContain(created.id);
    expect(
      (await listClients(owner, db, { includeInactive: true })).map((row) => row.id),
    ).toContain(created.id);
    // The twin starts with none: it keeps its own clients.
    const twin = await resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });
    await expect(listClients(twin, db)).resolves.toEqual([]);
  });

  it('stores prices as exact decimals and offers only today’s IVA rates', async () => {
    const created = await createProduct(owner, db, product('SRV-001'));
    expect(created.price).toBe('25.123456');
    await expect(
      createProduct(owner, db, { ...product('SRV-002'), ivaRateCode: '2' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      createProduct(owner, db, { ...product('SRV-003'), price: '1.1234567' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(createProduct(owner, db, product('SRV-001'))).rejects.toMatchObject({
      code: 'CODE_TAKEN',
    });
    const detail = { name: 'Lote', value: 'A1' };
    await expect(
      updateProduct(owner, db, created.id, {
        ...product('SRV-001'),
        additionalDetails: [detail, detail, detail, detail],
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      updateProduct(owner, db, created.id, {
        ...product('SRV-001'),
        additionalDetails: [{ name: 'Nota', value: 'dos\tcampos' }],
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect((await listProducts(owner, db, { query: 'srv-001' })).map((row) => row.code)).toEqual([
      'SRV-001',
    ]);
  });

  it('lists by state, type and order, as the screens ask', async () => {
    const ana = await createClient(owner, db, { ...client('ZP-1', '06'), name: 'Zeta Ana' });
    const bruno = await createClient(owner, db, { ...client('ZP-2', '08'), name: 'Zeta Bruno' });
    await setClientActive(owner, db, { id: bruno.id, active: false });
    const names = async (options: Parameters<typeof listClients>[2]) =>
      (await listClients(owner, db, { query: 'zeta', ...options })).map((row) => row.name);
    expect(await names({ status: 'all' })).toEqual(['Zeta Ana', 'Zeta Bruno']);
    expect(await names({ status: 'active' })).toEqual(['Zeta Ana']);
    expect(await names({ status: 'inactive' })).toEqual(['Zeta Bruno']);
    expect(await names({ status: 'all', idType: '08' })).toEqual(['Zeta Bruno']);
    // The older switch still means what it did.
    expect(await names({ includeInactive: true })).toHaveLength(2);
    expect(await names({})).toEqual(['Zeta Ana']);
    // A chosen order replaces "active first"; the other direction reverses it.
    expect(await names({ status: 'all', sort: 'identification', direction: 'desc' })).toEqual([
      'Zeta Bruno',
      'Zeta Ana',
    ]);
    expect(await names({ status: 'all', sort: 'name', direction: 'desc' })).toEqual([
      'Zeta Bruno',
      'Zeta Ana',
    ]);
    expect(ana.active).toBe(true);

    const cheap = await createProduct(owner, db, {
      ...product('ZP-1'),
      name: 'Zeta barato',
      kind: 'GOOD',
      price: '5',
    });
    await createProduct(owner, db, { ...product('ZP-2'), name: 'Zeta caro', price: '50' });
    const codes = async (options: Parameters<typeof listProducts>[2]) =>
      (await listProducts(owner, db, { query: 'zeta', ...options })).map((row) => row.code);
    expect(await codes({ kind: 'GOOD' })).toEqual([cheap.code]);
    expect(await codes({ sort: 'price', direction: 'desc' })).toEqual(['ZP-2', 'ZP-1']);
    expect(await codes({ sort: 'price', direction: 'asc' })).toEqual(['ZP-1', 'ZP-2']);
    expect(await codes({ sort: 'code', direction: 'desc' })).toEqual(['ZP-2', 'ZP-1']);
  });

  it('needs the role and the feature, in core', async () => {
    const viewer = { ...owner, permissions: ['clients.read', 'catalog.read'] };
    await expect(listClients(viewer, db)).resolves.toBeInstanceOf(Array);
    await expect(createClient(viewer, db, client('0912345675'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'CATALOG',
      effect: 'REVOKE',
      limitValue: null,
      reason: 'test',
    });
    const withoutCatalog = await resolveActor(db, {
      userId: ownerId,
      tenantId: org.realTenantId,
      clock,
    });
    await expect(listProducts(withoutCatalog, db)).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENABLED',
    });
  });
});
