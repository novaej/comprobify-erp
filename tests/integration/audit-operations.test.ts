import { randomUUID } from 'node:crypto';
import {
  addModule,
  adjustStock,
  auditCategoryOf,
  AUDIT_ACTIONS,
  cancelPurchaseOrder,
  cancelSaleOrder,
  createClient,
  createOrganization,
  createProduct,
  createProvider,
  createPurchaseOrder,
  createSaleOrder,
  exportClients,
  exportProducts,
  fixedClock,
  listAuditEvents,
  orderWarehouses,
  resolveActor,
  setClientActive,
  setOpeningBalance,
  setProductActive,
  updateClient,
  updateProduct,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { OPERATIONS_AUDIT_ACTIONS, schema, type Database } from '@comprobify/db';
import { testRuc } from '@comprobify/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-NOT-4, ADR-041: what the business did is in the log, apart from the account's own events.
describe('the operations log', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let userId: string;
  let owner: ActorContext;

  const operations = async (ctx = owner) =>
    (await listAuditEvents(ctx, db, { category: 'OPERATIONS', limit: 200 })).map((event) => ({
      action: event.action,
      details: event.details,
      actorName: event.actorName,
    }));
  const find = async (action: string) =>
    (await operations()).filter((event) => event.action === action);

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `ao.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    userId = user!.id;
    org = await createOrganization(db, {
      ownerUserId: userId,
      ruc: testRuc(),
      legalName: 'Rho S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    for (const moduleKey of ['PURCHASING', 'INVENTORY', 'SALES'])
      await addModule(await superAdmin(db), db, { realTenantId: org.realTenantId, moduleKey });
    owner = await resolveActor(db, { userId, tenantId: org.realTenantId, clock });
  });

  afterAll(() => db.close());

  it('puts every action in exactly one category', () => {
    for (const action of AUDIT_ACTIONS)
      expect(auditCategoryOf(action)).toBe(
        (OPERATIONS_AUDIT_ACTIONS as readonly string[]).includes(action) ? 'OPERATIONS' : 'ACCOUNT',
      );
  });

  it('records a product, what a price was and what it is, and its state', async () => {
    const created = await createProduct(owner, db, {
      code: 'CAF-1',
      name: 'Café',
      kind: 'GOOD',
      unit: 'kg',
      price: '5.00',
      ivaRateCode: '4',
      tracksStock: true,
    });
    await updateProduct(owner, db, created.id, {
      code: 'CAF-1',
      name: 'Café',
      kind: 'GOOD',
      unit: 'kg',
      price: '6.00',
      ivaRateCode: '4',
      tracksStock: true,
    });
    // Nothing changed: nothing recorded.
    await updateProduct(owner, db, created.id, {
      code: 'CAF-1',
      name: 'Café',
      kind: 'GOOD',
      unit: 'kg',
      price: '6.00',
      ivaRateCode: '4',
      tracksStock: true,
    });
    await setProductActive(owner, db, { id: created.id, active: false });
    expect((await find('product.created'))[0]!.details).toMatchObject({ label: 'CAF-1 · Café' });
    const updates = await find('product.updated');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.details.changes).toEqual({ price: ['5.000000', '6.000000'] });
    expect((await find('product.active_changed'))[0]!.details).toMatchObject({ active: false });
  });

  it("records a client's change by field name only, never the values", async () => {
    const client = await createClient(owner, db, {
      idType: '06',
      identification: 'PASS-1',
      name: 'Ana',
      emails: ['ana@secreto.example'],
    });
    await updateClient(owner, db, client.id, {
      idType: '06',
      identification: 'PASS-1',
      name: 'Ana',
      emails: ['otra@secreto.example'],
      phone: '0999999999',
    });
    await setClientActive(owner, db, { id: client.id, active: false });
    const [update] = await find('client.updated');
    expect(update!.details.fields).toEqual(['emails', 'phone']);
    // The log names the fields; what they hold stays on the client.
    expect(JSON.stringify(update!.details)).not.toContain('secreto');
    expect(JSON.stringify(update!.details)).not.toContain('0999999999');
    expect(await find('client.created')).toHaveLength(1);
    expect(await find('client.active_changed')).toHaveLength(1);
  });

  it('records stock set and adjusted, with the reason and who', async () => {
    const [product] = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.products),
    );
    const warehouseId = (await orderWarehouses(owner, db))[0]!.id;
    await setOpeningBalance(owner, db, {
      productId: product!.id,
      warehouseId,
      quantity: '10',
      unitCost: '2',
    });
    await adjustStock(owner, db, {
      productId: product!.id,
      warehouseId,
      direction: 'OUT',
      quantity: '2',
      unitCost: null,
      reason: 'Merma',
    });
    expect((await find('stock.opening_set'))[0]!.details).toMatchObject({
      label: 'CAF-1 · Matriz',
      quantity: '10',
    });
    const [adjusted] = await find('stock.adjusted');
    expect(adjusted!.details).toMatchObject({
      label: 'CAF-1 · Matriz',
      direction: 'OUT',
      quantity: '2',
      reason: 'Merma',
    });
    expect(adjusted!.actorName).toBe('Owner');
  });

  it('records a cancelled purchase order and a cancelled sale order', async () => {
    const provider = await createProvider(owner, db, {
      idType: '04',
      identification: '1790012345001',
      name: 'Proveedor S.A.',
      emails: [],
    });
    const [product] = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.products),
    );
    // Deactivated above; an order takes active products only.
    await setProductActive(owner, db, { id: product!.id, active: true });
    const warehouseId = (await orderWarehouses(owner, db))[0]!.id;
    const purchase = await createPurchaseOrder(owner, db, {
      providerId: provider.id,
      warehouseId,
      lines: [{ productId: product!.id, quantity: '1', unitCost: '2' }],
    });
    await cancelPurchaseOrder(owner, db, { id: purchase.id, reason: 'Ya no se necesita' });
    const sale = await createSaleOrder(owner, db, {
      clientId: null,
      warehouseId,
      lines: [{ productId: product!.id, quantity: '1', unitPrice: '5', discount: '0' }],
    });
    await cancelSaleOrder(owner, db, { id: sale.id, reason: 'El cliente desistió' });
    expect((await find('provider.created'))[0]!.details).toMatchObject({
      label: '1790012345001 · Proveedor S.A.',
    });
    expect((await find('purchase_order.cancelled'))[0]!.details).toMatchObject({
      label: 'OC-000001',
      reason: 'Ya no se necesita',
    });
    expect((await find('sale_order.cancelled'))[0]!.details).toMatchObject({
      label: 'PV-000001',
      reason: 'El cliente desistió',
    });
  });

  it('records who took data out', async () => {
    await exportClients(owner, db, { locale: 'es' });
    await exportProducts(owner, db, { locale: 'es', decimal: ',' });
    const exported = (await find('data.exported')).map((event) => event.details.export);
    expect(exported).toEqual(expect.arrayContaining(['clients', 'products']));
  });

  it('keeps the two categories apart, each behind its own permission', async () => {
    const accountOnly = { ...owner, permissions: ['audit.read'] } satisfies ActorContext;
    const operationsOnly = {
      ...owner,
      permissions: ['audit.operations.read'],
    } satisfies ActorContext;
    // Each reads only its own; a person with neither reads nothing.
    await expect(
      listAuditEvents(accountOnly, db, { category: 'OPERATIONS' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      listAuditEvents(operationsOnly, db, { category: 'ACCOUNT' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const bothOf = async (ctx: ActorContext) =>
      new Set((await listAuditEvents(ctx, db, { limit: 500 })).map((event) => event.category));
    expect(await bothOf(accountOnly)).toEqual(new Set(['ACCOUNT']));
    expect(await bothOf(operationsOnly)).toEqual(new Set(['OPERATIONS']));
    expect(await bothOf(owner)).toEqual(new Set(['ACCOUNT', 'OPERATIONS']));
    await expect(
      listAuditEvents({ ...owner, permissions: [] } satisfies ActorContext, db),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('records a test copy’s operations in the test copy only', async () => {
    const twin = await resolveActor(db, { userId, tenantId: org.twinTenantId, clock });
    expect(await operations(twin)).toEqual([]);
    await createProduct(twin, db, {
      code: 'T-1',
      name: 'Solo pruebas',
      kind: 'SERVICE',
      price: '1',
      ivaRateCode: '0',
    });
    expect((await operations(twin)).map((event) => event.action)).toEqual(['product.created']);
    // The real company's log does not hold the test copy's.
    expect(
      (await find('product.created')).some((event) => event.details.label === 'T-1 · Solo pruebas'),
    ).toBe(false);
  });
});
