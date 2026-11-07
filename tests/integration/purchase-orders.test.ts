import { randomUUID } from 'node:crypto';
import {
  addModule,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createOrganization,
  createProduct,
  createProvider,
  createPurchaseOrder,
  fixedClock,
  getPurchaseOrder,
  listPurchaseOrders,
  markPurchaseOrderSent,
  orderWarehouses,
  resolveActor,
  setProductActive,
  setProviderActive,
  updatePurchaseOrder,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { purchaseOrderStatusTriggerBody, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-PUR-1, FR-DOC-3 (ADR-019).
describe('purchase orders', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let owner: ActorContext;
  let providerId: string;
  let warehouseId: string;
  let goodId: string;
  let serviceId: string;

  const actorFor = async (tenantId: string) =>
    resolveActor(db, { userId: owner.userId!, tenantId, clock });

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `po.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: 'Pi S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    owner = await resolveActor(db, { userId: user!.id, tenantId: org.realTenantId, clock });
  });

  afterAll(() => db.close());

  it('needs the Compras module', async () => {
    await expect(listPurchaseOrders(owner, db)).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENABLED',
    });
    await addModule(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      moduleKey: 'PURCHASING',
    });
    owner = await actorFor(org.realTenantId);
    providerId = (
      await createProvider(owner, db, {
        idType: '04',
        identification: '1790012345001',
        name: 'Distribuidora Andina S.A.',
        emails: ['compras@andina.ec'],
      })
    ).id;
    warehouseId = (await orderWarehouses(owner, db))[0]!.id;
    goodId = (
      await createProduct(owner, db, {
        code: 'CAF-1',
        name: 'Café en grano',
        kind: 'GOOD',
        unit: 'kg',
        price: '12.00',
        ivaRateCode: '4',
        tracksStock: true,
      })
    ).id;
    serviceId = (
      await createProduct(owner, db, {
        code: 'FLETE',
        name: 'Flete',
        kind: 'SERVICE',
        price: '5.00',
        ivaRateCode: '0',
      })
    ).id;
  });

  it('numbers each order per company, prices it without IVA and adds the tax by line', async () => {
    const order = await createPurchaseOrder(owner, db, {
      providerId,
      warehouseId,
      expectedDate: '2026-11-15',
      notes: '  Entregar en bodega  ',
      lines: [
        { productId: goodId, quantity: '3', unitCost: '7.333333' },
        { productId: serviceId, quantity: '1', unitCost: '4.50' },
      ],
    });
    expect(order).toMatchObject({
      status: 'DRAFT',
      orderDate: '2026-11-10',
      notes: 'Entregar en bodega',
      // 22.00 at 15% is 3.30; the freight is IVA 0.
      subtotal: '26.50',
      iva: '3.30',
      total: '29.80',
    });
    const second = await createPurchaseOrder(owner, db, {
      providerId,
      warehouseId,
      lines: [{ productId: goodId, quantity: '1', unitCost: '7' }],
    });
    expect(second.number).toBe(order.number + 1);

    const view = await getPurchaseOrder(owner, db, order.id);
    expect(view.provider.name).toBe('Distribuidora Andina S.A.');
    expect(view.lines.map((line) => [line.code, line.ivaRateCode, line.subtotal])).toEqual([
      ['CAF-1', '4', '22.00'],
      ['FLETE', '0', '4.50'],
    ]);
  });

  it('never gives two orders taken at once the same number', async () => {
    const orders = await Promise.all(
      Array.from({ length: 6 }, () =>
        createPurchaseOrder(owner, db, {
          providerId,
          warehouseId,
          lines: [{ productId: goodId, quantity: '1', unitCost: '1' }],
        }),
      ),
    );
    const numbers = orders.map((order) => order.number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers.at(-1)! - numbers[0]!).toBe(5);
  });

  it('edits a draft as a new revision, then only moves its status', async () => {
    const order = await createPurchaseOrder(owner, db, {
      providerId,
      warehouseId,
      lines: [{ productId: goodId, quantity: '1', unitCost: '7' }],
    });
    const edited = await updatePurchaseOrder(owner, db, order.id, {
      providerId,
      warehouseId,
      lines: [
        { productId: goodId, quantity: '2', unitCost: '7' },
        { productId: serviceId, quantity: '1', unitCost: '3' },
      ],
    });
    expect(edited).toMatchObject({ revision: 2, subtotal: '17.00', total: '19.10' });
    expect((await getPurchaseOrder(owner, db, order.id)).lines).toHaveLength(2);
    // The first revision's line is kept, not deleted (rule 12).
    const all = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.purchaseOrderLines),
    );
    expect(all.filter((line) => line.orderId === order.id)).toHaveLength(3);

    const sent = await markPurchaseOrderSent(owner, db, order.id);
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).toEqual(clock.now());
    await expect(
      updatePurchaseOrder(owner, db, order.id, {
        providerId,
        warehouseId,
        lines: [{ productId: goodId, quantity: '9', unitCost: '7' }],
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_DRAFT' });
    await expect(markPurchaseOrderSent(owner, db, order.id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    // Nothing has arrived, so it can't be closed, only cancelled.
    await expect(closePurchaseOrder(owner, db, order.id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    const cancelled = await cancelPurchaseOrder(owner, db, {
      id: order.id,
      reason: 'El proveedor no tiene stock',
    });
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'El proveedor no tiene stock',
    });
    await expect(
      cancelPurchaseOrder(owner, db, { id: order.id, reason: 'otra vez' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('refuses a bad expected date, an inactive provider or product', async () => {
    const base = {
      providerId,
      warehouseId,
      lines: [{ productId: goodId, quantity: '1', unitCost: '1' }],
    };
    await expect(
      createPurchaseOrder(owner, db, { ...base, expectedDate: '2026-11-09' }),
    ).rejects.toMatchObject({ code: 'EXPECTED_BEFORE_ORDER' });
    await expect(
      createPurchaseOrder(owner, db, { ...base, lines: [{ ...base.lines[0]!, quantity: '0' }] }),
    ).rejects.toThrow();

    const retired = await createProduct(owner, db, {
      code: 'OLD',
      name: 'Descontinuado',
      kind: 'GOOD',
      price: '1',
      ivaRateCode: '4',
    });
    await setProductActive(owner, db, { id: retired.id, active: false });
    await expect(
      createPurchaseOrder(owner, db, {
        ...base,
        lines: [...base.lines, { productId: retired.id, quantity: '1', unitCost: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_INACTIVE', details: { line: 2 } });

    await setProviderActive(owner, db, { id: providerId, active: false });
    await expect(createPurchaseOrder(owner, db, base)).rejects.toMatchObject({
      code: 'PROVIDER_INACTIVE',
    });
    await setProviderActive(owner, db, { id: providerId, active: true });
  });

  it('lists newest first and finds an order by provider or number', async () => {
    const list = await listPurchaseOrders(owner, db);
    expect(list.total).toBeGreaterThanOrEqual(9);
    expect(list.rows[0]!.number).toBeGreaterThan(list.rows[1]!.number);
    const first = list.rows.at(-1)!;
    const byNumber = await listPurchaseOrders(owner, db, { query: `OC-${first.number}` });
    expect(byNumber.rows.map((row) => row.id)).toContain(first.id);
    expect((await listPurchaseOrders(owner, db, { query: 'andina' })).total).toBe(list.total);
    expect((await listPurchaseOrders(owner, db, { status: 'CANCELLED' })).total).toBe(1);
  });

  it('keeps the twin apart, with numbers of its own', async () => {
    const twin = await actorFor(org.twinTenantId);
    expect((await listPurchaseOrders(twin, db)).total).toBe(0);
    const twinProvider = await createProvider(twin, db, {
      idType: '04',
      identification: '1790012345001',
      name: 'Andina (pruebas)',
    });
    const twinProduct = await createProduct(twin, db, {
      code: 'CAF-1',
      name: 'Café',
      kind: 'GOOD',
      price: '1',
      ivaRateCode: '4',
    });
    const order = await createPurchaseOrder(twin, db, {
      providerId: twinProvider.id,
      warehouseId: (await orderWarehouses(twin, db))[0]!.id,
      lines: [{ productId: twinProduct.id, quantity: '1', unitCost: '1' }],
    });
    expect(order.number).toBe(1);
    // The real company's provider isn't visible from the twin.
    await expect(
      createPurchaseOrder(twin, db, {
        providerId,
        warehouseId: (await orderWarehouses(twin, db))[0]!.id,
        lines: [{ productId: twinProduct.id, quantity: '1', unitCost: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('holds the status machine in the database too', async () => {
    const order = await createPurchaseOrder(owner, db, {
      providerId,
      warehouseId,
      lines: [{ productId: goodId, quantity: '1', unitCost: '1' }],
    });
    await expect(
      db.withSystem('test: skip a status', ({ executeSql }) =>
        executeSql(`UPDATE purchase_orders SET status = 'RECEIVED' WHERE id = $1`, [order.id]),
      ),
    ).rejects.toThrow();
    // A line's content can't change; only what has arrived.
    await expect(
      db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) =>
        executeSql(`UPDATE purchase_order_lines SET unit_cost = 0 WHERE order_id = $1`, [order.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    const source = await db.withSystem('test: read the trigger', ({ executeSql }) =>
      executeSql<{ prosrc: string }>(
        `SELECT prosrc FROM pg_proc WHERE proname = 'app_purchase_order_status_check'`,
      ),
    );
    expect(source.rows[0]!.prosrc).toContain(purchaseOrderStatusTriggerBody());
  });

  it('lets a viewer read but not change orders', async () => {
    const viewer = { ...owner, permissions: ['purchasing.read'] };
    expect((await listPurchaseOrders(viewer, db)).total).toBeGreaterThan(0);
    await expect(
      createPurchaseOrder(viewer, db, {
        providerId,
        warehouseId,
        lines: [{ productId: goodId, quantity: '1', unitCost: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
