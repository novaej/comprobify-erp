import { randomUUID } from 'node:crypto';
import {
  addModule,
  adjustStock,
  cancelSaleOrder,
  confirmSaleOrder,
  createClient,
  createOrganization,
  createProduct,
  createSaleOrder,
  fixedClock,
  getSaleOrder,
  listSaleOrders,
  resolveActor,
  saleOrderWarehouses,
  setClientActive,
  setOverride,
  setProductActive,
  setNegativeStockRule,
  setOpeningBalance,
  updateSaleOrder,
  verifyStockLevels,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { and, eq, saleOrderStatusTriggerBody, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin, testLogger } from './helpers';

// FR-SAL-1, FR-SAL-2, FR-SAL-5, FR-DOC-3 (ADR-021).
describe('sale orders', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let owner: ActorContext;
  let clientId: string;
  let warehouseId: string;
  let coffee: string;
  let service: string;

  const actorFor = async (tenantId: string) =>
    resolveActor(db, { userId: owner.userId!, tenantId, clock });
  const level = (productId: string) =>
    db.withTenant({ tenantId: org.realTenantId }, async ({ db: tx }) => {
      const [row] = await tx
        .select({ onHand: schema.stockLevels.onHand, reserved: schema.stockLevels.reserved })
        .from(schema.stockLevels)
        .where(
          and(
            eq(schema.stockLevels.productId, productId),
            eq(schema.stockLevels.warehouseId, warehouseId),
          ),
        );
      return row;
    });
  const draft = (quantity = '3', extra: { clientId?: string | null } = {}) =>
    createSaleOrder(owner, db, {
      clientId: extra.clientId === undefined ? clientId : extra.clientId,
      warehouseId,
      lines: [{ productId: coffee, quantity, unitPrice: '5', discount: '0' }],
    });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `so.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: 'Omega S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    owner = await resolveActor(db, { userId: user!.id, tenantId: org.realTenantId, clock });
  });

  afterAll(() => db.close());

  it('needs the Ventas module', async () => {
    await expect(listSaleOrders(owner, db)).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENABLED',
    });
    const admin = await superAdmin(db);
    await addModule(admin, db, { realTenantId: org.realTenantId, moduleKey: 'SALES' });
    await setOverride(admin, db, {
      realTenantId: org.realTenantId,
      featureKey: 'INVENTORY',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    owner = await actorFor(org.realTenantId);
    clientId = (
      await createClient(owner, db, {
        idType: '05',
        identification: '1710034065',
        name: 'María López',
        emails: ['maria@example.com'],
      })
    ).id;
    warehouseId = (await saleOrderWarehouses(owner, db))[0]!.id;
    coffee = (
      await createProduct(owner, db, {
        code: 'CAF-1',
        name: 'Café molido',
        kind: 'GOOD',
        price: '5',
        cost: '2',
        ivaRateCode: '4',
        tracksStock: true,
      })
    ).id;
    service = (
      await createProduct(owner, db, {
        code: 'INST',
        name: 'Instalación',
        kind: 'SERVICE',
        price: '20',
        ivaRateCode: '0',
      })
    ).id;
    await setOpeningBalance(owner, db, {
      productId: coffee,
      warehouseId,
      quantity: '10',
      unitCost: '2',
    });
  });

  it('numbers each order per company and prices its lines as an invoice would', async () => {
    const order = await createSaleOrder(owner, db, {
      clientId,
      warehouseId,
      notes: '  Entregar el viernes  ',
      lines: [
        { productId: coffee, quantity: '3', unitPrice: '5.333333', discount: '1' },
        { productId: service, quantity: '1', unitPrice: '20', discount: '0' },
      ],
    });
    expect(order).toMatchObject({
      status: 'DRAFT',
      revision: 1,
      orderDate: '2026-11-10',
      notes: 'Entregar el viernes',
    });
    // 3 × 5.333333 − 1 = 15.00 at 15 % → 2.25, and 20.00 at 0 %.
    expect(order).toMatchObject({ subtotal: '35.00', iva: '2.25', total: '37.25' });
    const view = await getSaleOrder(owner, db, order.id);
    expect(view.lines.map((line) => [line.code, line.base, line.iva])).toEqual([
      ['CAF-1', '15.00', '2.25'],
      ['INST', '20.00', '0.00'],
    ]);
    const second = await draft();
    expect(second.number).toBe(order.number + 1);
    // A draft holds nothing.
    expect(await level(coffee)).toMatchObject({ reserved: '0.000000' });
  });

  it('holds the goods when confirmed and lets them go when cancelled', async () => {
    const before = Number((await level(coffee))!.reserved);
    const order = await draft('4');
    const confirmed = await confirmSaleOrder(owner, db, order.id);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmedAt).toEqual(clock.now());
    expect(Number((await level(coffee))!.reserved)).toBe(before + 4);
    expect(await level(coffee)).toMatchObject({ onHand: '10.000000' });

    const cancelled = await cancelSaleOrder(owner, db, {
      id: order.id,
      reason: 'El cliente desistió',
    });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'El cliente desistió' });
    expect(Number((await level(coffee))!.reserved)).toBe(before);
    expect(await failure(confirmSaleOrder(owner, db, order.id))).toBe('INVALID_TRANSITION');
    expect(await failure(cancelSaleOrder(owner, db, { id: order.id, reason: 'Otra vez' }))).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('cancels a draft without touching stock', async () => {
    const before = await level(coffee);
    const order = await draft('2');
    await cancelSaleOrder(owner, db, { id: order.id, reason: 'Duplicada' });
    expect(await level(coffee)).toEqual(before);
  });

  it('refuses to confirm more than is free, unless the company allows negative stock', async () => {
    const free = 10 - Number((await level(coffee))!.reserved);
    const order = await draft(String(free + 1));
    expect(await failure(confirmSaleOrder(owner, db, order.id))).toBe('INSUFFICIENT_STOCK');
    // The refusal rolled everything back: still a draft, nothing held.
    expect((await getSaleOrder(owner, db, order.id)).status).toBe('DRAFT');
    await setNegativeStockRule(owner, db, 'ALLOW');
    try {
      await confirmSaleOrder(await actorFor(org.realTenantId), db, order.id);
      expect(Number((await level(coffee))!.reserved)).toBe(10 + 1);
      await cancelSaleOrder(owner, db, { id: order.id, reason: 'Prueba' });
    } finally {
      await setNegativeStockRule(owner, db, 'BLOCK');
    }
  });

  it('edits a draft as a new revision, and a confirmed order holds its new quantities', async () => {
    const order = await draft('1');
    const edited = await updateSaleOrder(owner, db, order.id, {
      clientId: null,
      warehouseId,
      lines: [
        { productId: coffee, quantity: '2', unitPrice: '5', discount: '0' },
        { productId: service, quantity: '1', unitPrice: '20', discount: '0' },
      ],
    });
    expect(edited).toMatchObject({ revision: 2, clientId: null, total: '31.50' });
    const view = await getSaleOrder(owner, db, order.id);
    expect(view.lines).toHaveLength(2);
    // The first revision's line is still there.
    const all = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.saleOrderLines).where(eq(schema.saleOrderLines.orderId, order.id)),
    );
    expect(all).toHaveLength(3);

    const before = Number((await level(coffee))!.reserved);
    await confirmSaleOrder(owner, db, order.id);
    expect(Number((await level(coffee))!.reserved)).toBe(before + 2);
    await updateSaleOrder(owner, db, order.id, {
      clientId,
      warehouseId,
      lines: [{ productId: coffee, quantity: '5', unitPrice: '5', discount: '0' }],
    });
    expect(Number((await level(coffee))!.reserved)).toBe(before + 5);
    await cancelSaleOrder(owner, db, { id: order.id, reason: 'Prueba' });
    expect(Number((await level(coffee))!.reserved)).toBe(before);
    expect(
      await failure(
        updateSaleOrder(owner, db, order.id, {
          clientId,
          warehouseId,
          lines: [{ productId: coffee, quantity: '1', unitPrice: '5', discount: '0' }],
        }),
      ),
    ).toBe('ORDER_NOT_EDITABLE');
  });

  it('refuses an inactive client or product, a discount over its line, and unknown ones', async () => {
    const other = (
      await createClient(owner, db, {
        idType: '06',
        identification: 'PA123456',
        name: 'Pedro Paz',
        emails: [],
      })
    ).id;
    await setClientActive(owner, db, { id: other, active: false });
    expect(await failure(draft('1', { clientId: other }))).toBe('CLIENT_INACTIVE');
    expect(
      await failure(
        createSaleOrder(owner, db, {
          warehouseId,
          lines: [{ productId: coffee, quantity: '1', unitPrice: '5', discount: '6' }],
        }),
      ),
    ).toBe('LINE_DISCOUNT_TOO_LARGE');
    expect(
      await failure(
        createSaleOrder(owner, db, {
          warehouseId,
          lines: [{ productId: randomUUID(), quantity: '1', unitPrice: '5', discount: '0' }],
        }),
      ),
    ).toBe('NOT_FOUND');
    const idle = (
      await createProduct(owner, db, {
        code: 'IDLE',
        name: 'Sin uso',
        kind: 'SERVICE',
        price: '1',
        ivaRateCode: '0',
      })
    ).id;
    await setProductActive(owner, db, { id: idle, active: false });
    expect(
      await failure(
        createSaleOrder(owner, db, {
          warehouseId,
          lines: [{ productId: idle, quantity: '1', unitPrice: '1', discount: '0' }],
        }),
      ),
    ).toBe('PRODUCT_INACTIVE');
  });

  it('holds nothing without Inventario, for services and for goods that track no stock', async () => {
    const actor = await actorFor(org.realTenantId);
    const without = {
      ...actor,
      entitlements: {
        ...actor.entitlements,
        features: actor.entitlements.features.filter((key) => key !== 'INVENTORY'),
      },
    };
    const before = await level(coffee);
    const order = await createSaleOrder(without, db, {
      warehouseId,
      lines: [
        { productId: coffee, quantity: '1', unitPrice: '5', discount: '0' },
        { productId: service, quantity: '1', unitPrice: '20', discount: '0' },
      ],
    });
    await confirmSaleOrder(without, db, order.id);
    expect(await level(coffee)).toEqual(before);
    // Services never have a level.
    const levels = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.stockLevels).where(eq(schema.stockLevels.productId, service)),
    );
    expect(levels).toEqual([]);
  });

  it('lists and searches by number, status and client', async () => {
    const all = await listSaleOrders(owner, db);
    expect(all.total).toBeGreaterThan(3);
    expect(all.rows[0]!.number).toBeGreaterThan(all.rows.at(-1)!.number);
    const byClient = await listSaleOrders(owner, db, { query: 'lópez' });
    expect(byClient.rows.every((row) => row.clientName === 'María López')).toBe(true);
    const byNumber = await listSaleOrders(owner, db, { query: 'PV-000001' });
    expect(byNumber.rows.map((row) => row.number)).toEqual([1]);
    const cancelled = await listSaleOrders(owner, db, { status: 'CANCELLED' });
    expect(cancelled.rows.every((row) => row.status === 'CANCELLED')).toBe(true);
  });

  it('keeps the levels equal to their ledger', async () => {
    await adjustStock(owner, db, {
      productId: coffee,
      warehouseId,
      direction: 'IN',
      quantity: '1',
      unitCost: '2',
      reason: 'Hallazgo',
    });
    const { drifts } = await verifyStockLevels({ db, logger: testLogger() });
    expect(drifts.filter((drift) => drift.tenantId === org.realTenantId)).toEqual([]);
  });

  it('holds the status machine in the database too', async () => {
    const order = await draft('1');
    await expect(
      db.withSystem('test: skip a status', ({ executeSql }) =>
        executeSql(`UPDATE sale_orders SET status = 'INVOICED' WHERE id = $1`, [order.id]),
      ),
    ).rejects.toThrow();
    await expect(
      db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) =>
        executeSql(`UPDATE sale_order_lines SET quantity = 99 WHERE order_id = $1`, [order.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    const source = await db.withSystem('test: read the trigger', ({ executeSql }) =>
      executeSql<{ prosrc: string }>(
        `SELECT prosrc FROM pg_proc WHERE proname = 'app_sale_order_status_check'`,
      ),
    );
    expect(source.rows[0]!.prosrc).toContain(saleOrderStatusTriggerBody());
  });

  it('lets a viewer read but not change orders, and keeps the twin apart', async () => {
    const viewer = { ...owner, permissions: ['sales.read'] };
    expect((await listSaleOrders(viewer, db)).total).toBeGreaterThan(0);
    await expect(draftAs(viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const twin = await actorFor(org.twinTenantId);
    expect((await listSaleOrders(twin, db)).total).toBe(0);
  });

  const draftAs = (actor: ActorContext) =>
    createSaleOrder(actor, db, {
      warehouseId,
      lines: [{ productId: coffee, quantity: '1', unitPrice: '5', discount: '0' }],
    });
});
