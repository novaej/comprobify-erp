import { randomUUID } from 'node:crypto';
import {
  addModule,
  closePurchaseOrder,
  createOrganization,
  createProduct,
  createProvider,
  createPurchaseOrder,
  fixedClock,
  getPurchaseOrder,
  markPurchaseOrderSent,
  orderWarehouses,
  receivePurchaseOrder,
  resolveActor,
  setOpeningBalance,
  verifyStockLevels,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { and, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin, testLogger } from './helpers';

// FR-PUR-2, FR-INV-1, FR-INV-5 (ADR-018, ADR-019).
describe('receiving purchase orders', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let owner: ActorContext;
  let providerId: string;
  let warehouseId: string;
  let goodId: string;
  let serviceId: string;
  let plainId: string;

  const level = (productId: string) =>
    db.withTenant({ tenantId: org.realTenantId }, async ({ db: tx }) => {
      const [row] = await tx
        .select()
        .from(schema.stockLevels)
        .where(
          and(
            eq(schema.stockLevels.productId, productId),
            eq(schema.stockLevels.warehouseId, warehouseId),
          ),
        );
      return row ?? null;
    });

  const sentOrder = async (lines: { productId: string; quantity: string; unitCost: string }[]) => {
    const order = await createPurchaseOrder(owner, db, { providerId, warehouseId, lines });
    await markPurchaseOrderSent(owner, db, order.id);
    return getPurchaseOrder(owner, db, order.id);
  };

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `pr.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: 'Rho S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    for (const moduleKey of ['PURCHASING', 'INVENTORY'])
      await addModule(await superAdmin(db), db, { realTenantId: org.realTenantId, moduleKey });
    owner = await resolveActor(db, { userId: user!.id, tenantId: org.realTenantId, clock });
    providerId = (
      await createProvider(owner, db, {
        idType: '04',
        identification: '1790012345001',
        name: 'Distribuidora Andina S.A.',
      })
    ).id;
    warehouseId = (await orderWarehouses(owner, db))[0]!.id;
    const product = (code: string, kind: 'GOOD' | 'SERVICE', tracksStock: boolean) =>
      createProduct(owner, db, {
        code,
        name: code,
        kind,
        price: '5',
        ivaRateCode: '4',
        tracksStock,
      });
    goodId = (await product('CAF-1', 'GOOD', true)).id;
    serviceId = (await product('FLETE', 'SERVICE', false)).id;
    plainId = (await product('BOLSA', 'GOOD', false)).id;
  });

  afterAll(() => db.close());

  it('receives in parts, moving stock at the order cost and the order status with it', async () => {
    const order = await sentOrder([
      { productId: goodId, quantity: '10', unitCost: '2.50' },
      { productId: serviceId, quantity: '1', unitCost: '8' },
    ]);
    const [good, service] = order.lines;
    const first = await receivePurchaseOrder(owner, db, {
      orderId: order.id,
      lines: [{ lineId: good!.id, quantity: '4' }],
    });
    expect(first.order.status).toBe('PARTIALLY_RECEIVED');
    expect(await level(goodId)).toMatchObject({
      onHand: '4.000000',
      value: '10.000000',
      averageCost: '2.500000',
    });

    // More than is left changes nothing: the whole receipt is refused.
    await expect(
      receivePurchaseOrder(owner, db, {
        orderId: order.id,
        lines: [
          { lineId: service!.id, quantity: '1' },
          { lineId: good!.id, quantity: '6.5' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_EXCEEDS_ORDER', details: { line: 1, left: '6' } });
    expect((await level(goodId))!.onHand).toBe('4.000000');

    const second = await receivePurchaseOrder(owner, db, {
      orderId: order.id,
      lines: [
        { lineId: good!.id, quantity: '6' },
        { lineId: service!.id, quantity: '1' },
      ],
      notes: 'Guía 001-001-123',
    });
    expect(second.order.status).toBe('RECEIVED');
    expect((await level(goodId))!.onHand).toBe('10.000000');

    const view = await getPurchaseOrder(owner, db, order.id);
    expect(view.lines.map((line) => line.receivedQuantity)).toEqual(['10.000000', '1.000000']);
    expect(view.receipts).toHaveLength(2);
    // A service is received without a movement.
    expect(view.receipts[1]!.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderLineId: service!.id, moved: false }),
        expect.objectContaining({ orderLineId: good!.id, moved: true }),
      ]),
    );
    const movements = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.stockMovements)
        .where(eq(schema.stockMovements.sourceType, 'PURCHASE_RECEIPT')),
    );
    expect(movements.map((movement) => movement.sourceId).sort()).toEqual(
      view.receipts.map((receipt) => receipt.id).sort(),
    );

    await expect(
      receivePurchaseOrder(owner, db, {
        orderId: order.id,
        lines: [{ lineId: good!.id, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });
    expect((await closePurchaseOrder(owner, db, order.id)).status).toBe('CLOSED');
  });

  it('averages the receipt with what the warehouse already holds', async () => {
    const id = (
      await createProduct(owner, db, {
        code: 'AZU-1',
        name: 'Azúcar',
        kind: 'GOOD',
        price: '3',
        ivaRateCode: '4',
        tracksStock: true,
      })
    ).id;
    await setOpeningBalance(owner, db, {
      productId: id,
      warehouseId,
      quantity: '10',
      unitCost: '2',
    });
    const order = await sentOrder([{ productId: id, quantity: '10', unitCost: '3' }]);
    await receivePurchaseOrder(owner, db, {
      orderId: order.id,
      lines: [{ lineId: order.lines[0]!.id, quantity: '10' }],
    });
    expect(await level(id)).toMatchObject({
      onHand: '20.000000',
      value: '50.000000',
      averageCost: '2.500000',
    });
  });

  it('receives goods that track no stock, or any good without Inventario, without a movement', async () => {
    const order = await sentOrder([
      { productId: plainId, quantity: '5', unitCost: '0.10' },
      { productId: goodId, quantity: '2', unitCost: '2.50' },
    ]);
    const before = (await level(goodId))!.onHand;
    const withoutInventory: ActorContext = {
      ...owner,
      entitlements: {
        ...owner.entitlements,
        features: owner.entitlements.features.filter((key) => key !== 'INVENTORY'),
      },
    };
    await receivePurchaseOrder(withoutInventory, db, {
      orderId: order.id,
      lines: order.lines.map((line) => ({ lineId: line.id, quantity: line.quantity })),
    });
    expect(await level(plainId)).toBeNull();
    expect((await level(goodId))!.onHand).toBe(before);
    const view = await getPurchaseOrder(owner, db, order.id);
    expect(view.status).toBe('RECEIVED');
    expect(view.receipts[0]!.lines.every((line) => !line.moved)).toBe(true);
  });

  it('refuses a draft, a cancelled order, a line twice, and closes short', async () => {
    const draft = await createPurchaseOrder(owner, db, {
      providerId,
      warehouseId,
      lines: [{ productId: goodId, quantity: '3', unitCost: '2' }],
    });
    const [line] = (await getPurchaseOrder(owner, db, draft.id)).lines;
    await expect(
      receivePurchaseOrder(owner, db, {
        orderId: draft.id,
        lines: [{ lineId: line!.id, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });

    const order = await sentOrder([{ productId: goodId, quantity: '3', unitCost: '2' }]);
    await expect(
      receivePurchaseOrder(owner, db, {
        orderId: order.id,
        lines: [
          { lineId: order.lines[0]!.id, quantity: '1' },
          { lineId: order.lines[0]!.id, quantity: '1' },
        ],
      }),
    ).rejects.toThrow();
    // A line of another order isn't this order's.
    await expect(
      receivePurchaseOrder(owner, db, {
        orderId: order.id,
        lines: [{ lineId: line!.id, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await receivePurchaseOrder(owner, db, {
      orderId: order.id,
      lines: [{ lineId: order.lines[0]!.id, quantity: '1' }],
    });
    const closed = await closePurchaseOrder(owner, db, order.id);
    expect(closed.status).toBe('CLOSED');
    await expect(
      receivePurchaseOrder(owner, db, {
        orderId: order.id,
        lines: [{ lineId: order.lines[0]!.id, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });
  });

  it('keeps receipts append-only and the ledger matching the levels', async () => {
    await expect(
      db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) =>
        executeSql(`UPDATE purchase_receipt_lines SET quantity = 99`),
      ),
    ).rejects.toThrow(/permission denied/);
    const { drifts } = await verifyStockLevels({ db, logger: testLogger() });
    expect(drifts.filter((drift) => drift.tenantId === org.realTenantId)).toEqual([]);
  });

  it('needs purchasing.manage to receive', async () => {
    const order = await sentOrder([{ productId: goodId, quantity: '1', unitCost: '1' }]);
    const reader = { ...owner, permissions: ['purchasing.read', 'inventory.adjust'] };
    await expect(
      receivePurchaseOrder(reader, db, {
        orderId: order.id,
        lines: [{ lineId: order.lines[0]!.id, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
