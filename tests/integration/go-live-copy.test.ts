import { randomUUID } from 'node:crypto';
import {
  addModule,
  createClient,
  createOrganization,
  createProduct,
  createProvider,
  fixedClock,
  goLive,
  listClients,
  listProducts,
  listProviders,
  listTemplates,
  masterDataToCopy,
  resolveActor,
  saveTemplate,
  setClientActive,
  setOverride,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-ONB-5: going live can copy the twin's master data to the real company, once.
describe('copying the test copy to the real company at go-live', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  const actorFor = (userId: string, tenantId: string) =>
    resolveActor(db, { userId, tenantId, clock });

  async function company(name: string): Promise<{
    org: CreatedOrganization;
    userId: string;
    twin: ActorContext;
  }> {
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name, email: `gl.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: name,
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_TEMPLATES',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    await addModule(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      moduleKey: 'PURCHASING',
    });
    return { org, userId: user!.id, twin: await actorFor(user!.id, org.twinTenantId) };
  }

  beforeAll(() => {
    db = appDatabase();
  });
  afterAll(() => db.close());

  it('copies the active master data, moves a template to the copies, and never duplicates', async () => {
    const { org, userId, twin } = await company('Tau S.A.');
    const real = await actorFor(userId, org.realTenantId);
    const maria = await createClient(twin, db, {
      idType: '05',
      identification: '1710034065',
      name: 'María López',
      emails: ['maria@example.com'],
    });
    const old = await createClient(twin, db, {
      idType: '06',
      identification: 'PA123456',
      name: 'Cliente antiguo',
      emails: [],
    });
    await setClientActive(twin, db, { id: old.id, active: false });
    const coffee = await createProduct(twin, db, {
      code: 'CAF-1',
      name: 'Café',
      kind: 'GOOD',
      price: '5',
      ivaRateCode: '4',
      tracksStock: true,
    });
    await createProduct(twin, db, {
      code: 'SERV',
      name: 'Servicio',
      kind: 'SERVICE',
      price: '20',
      ivaRateCode: '0',
    });
    await createProvider(twin, db, {
      idType: '05',
      identification: '1710034065',
      name: 'Proveedor',
    });
    await saveTemplate(twin, db, {
      name: 'Pedido mensual',
      content: {
        clientId: maria.id,
        lines: [
          {
            productId: coffee.id,
            code: 'CAF-1',
            name: 'Café',
            quantity: '3',
            unitPrice: '5',
            ivaRateCode: '4',
          },
          {
            productId: null,
            code: 'X',
            name: 'Libre',
            quantity: '1',
            unitPrice: '1',
            ivaRateCode: '0',
          },
        ],
        payments: [{ method: '01', amount: '17.25' }],
      },
    });
    // The real company began entering data first: its own CAF-1 stays as it is.
    await createProduct(real, db, {
      code: 'CAF-1',
      name: 'Café de la real',
      kind: 'GOOD',
      price: '9',
      ivaRateCode: '4',
    });

    expect(await masterDataToCopy(real, db)).toEqual({
      products: 2,
      clients: 1,
      providers: 1,
      templates: 1,
    });
    const result = await goLive(real, db, { requireAgreements: false, copyMasterData: true });
    // CAF-1 clashed, so only the service was added.
    expect(result.copied).toEqual({ products: 1, clients: 1, providers: 1, templates: 1 });

    const products = await listProducts(await actorFor(userId, org.realTenantId), db);
    expect(products.map((product) => [product.code, product.name]).sort()).toEqual([
      ['CAF-1', 'Café de la real'],
      ['SERV', 'Servicio'],
    ]);
    const clients = await listClients(real, db);
    expect(clients.map((client) => client.identification)).toEqual(['1710034065']);
    expect((await listProviders(real, db)).map((provider) => provider.name)).toEqual(['Proveedor']);
    // The template points at the real copies of the client and the product.
    const [template] = await listTemplates(real, db);
    expect(template!.name).toBe('Pedido mensual');
    expect(template!.content.clientId).toBe(clients[0]!.id);
    expect(template!.content.lines[0]!.productId).toBe(
      products.find((product) => product.code === 'CAF-1')!.id,
    );
    expect(template!.content.lines[1]!.productId).toBeNull();
    // The twin keeps its own, untouched.
    expect((await listClients(twin, db)).map((client) => client.id)).toContain(maria.id);

    // It happens once: the company is live, and a second go-live refuses.
    await expect(
      goLive(real, db, { requireAgreements: false, copyMasterData: true }),
    ).rejects.toMatchObject({ code: 'ALREADY_LIVE' });
    expect((await listProducts(real, db)).length).toBe(2);
  });

  it('copies nothing when it is not asked for, and nothing without an organization.go_live role', async () => {
    const { org, userId, twin } = await company('Upsilon S.A.');
    await createClient(twin, db, {
      idType: '05',
      identification: '1710034065',
      name: 'María López',
      emails: [],
    });
    const real = await actorFor(userId, org.realTenantId);
    await expect(masterDataToCopy({ ...real, permissions: [] }, db)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const result = await goLive(real, db, { requireAgreements: false });
    expect(result.copied).toBeNull();
    expect(await listClients(real, db)).toEqual([]);
  });
});
