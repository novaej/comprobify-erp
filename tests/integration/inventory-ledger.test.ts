import { randomUUID } from 'node:crypto';
import {
  applyMovement,
  createKeyCipher,
  createProduct,
  fixedClock,
  onboardOrganization,
  resolveActor,
  setOverride,
  type ActorContext,
  type CreatedOrganization,
  type MovementInput,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { asc, eq, schema, sql, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-INV-1, FR-INV-2, FR-INV-4, FR-INV-5, FR-INV-6 (ADR-018): the ledger and its levels.
describe('inventory ledger', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('c4'.repeat(32));
  let db: Database;
  let org: CreatedOrganization;
  let ownerId: string;
  let warehouseId: string;

  const owner = () => resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });
  const move = async (input: MovementInput, actor?: ActorContext) => {
    const ctx = actor ?? (await owner());
    return db.withTenant({ tenantId: ctx.tenantId }, (tx) => applyMovement(ctx, tx, input));
  };
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const product = async (overrides: { tracksStock?: boolean; kind?: 'GOOD' | 'SERVICE' } = {}) =>
    (
      await createProduct(await owner(), db, {
        code: `P-${randomUUID().slice(0, 8)}`,
        name: 'Café molido',
        kind: overrides.kind ?? 'GOOD',
        price: '5',
        cost: '2',
        ivaRateCode: '4',
        tracksStock: overrides.tracksStock ?? true,
      })
    ).id;
  const ledger = (productId: string) =>
    db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.stockMovements)
        .where(eq(schema.stockMovements.productId, productId))
        .orderBy(asc(schema.stockMovements.id)),
    );
  const setRule = (rule: 'BLOCK' | 'ALLOW') =>
    db.withSystem('test: set the negative stock rule', ({ db: tx }) =>
      tx
        .update(schema.tenants)
        .set({ negativeStock: rule })
        .where(eq(schema.tenants.id, org.twinTenantId)),
    );

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `inv.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Inventario S.A.',
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
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'INVENTORY',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    const [warehouse] = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx.select().from(schema.warehouses),
    );
    warehouseId = warehouse!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the level and the weighted average with each movement, and the ledger sums to it', async () => {
    const id = await product();
    await move({
      type: 'OPENING_BALANCE',
      productId: id,
      warehouseId,
      quantity: '10',
      unitCost: '2.50',
    });
    await move({
      type: 'PURCHASE_RECEIPT',
      productId: id,
      warehouseId,
      quantity: '30',
      unitCost: '3.10',
    });
    const { level } = await move({
      type: 'ADJUSTMENT_OUT',
      productId: id,
      warehouseId,
      quantity: '15',
      reason: 'Merma',
    });
    expect(level).toMatchObject({
      onHand: '25.000000',
      reserved: '0.000000',
      value: '73.750000',
      averageCost: '2.950000',
    });

    const rows = await ledger(id);
    expect(rows.map((row) => [row.type, row.quantity, row.unitCost, row.value])).toEqual([
      ['OPENING_BALANCE', '10.000000', '2.500000', '25.000000'],
      ['PURCHASE_RECEIPT', '30.000000', '3.100000', '93.000000'],
      ['ADJUSTMENT_OUT', '-15.000000', '2.950000', '-44.250000'],
    ]);
    expect(rows[2]).toMatchObject({ reason: 'Merma', createdBy: ownerId });
    const [sums] = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx
        .select({
          quantity: sql<string>`sum(${schema.stockMovements.quantity})`,
          value: sql<string>`sum(${schema.stockMovements.value})`,
        })
        .from(schema.stockMovements)
        .where(eq(schema.stockMovements.productId, id)),
    );
    expect(sums).toEqual({ quantity: '25.000000', value: '73.750000' });
  });

  it('starts a level at the product cost and blocks taking out more than is available', async () => {
    const id = await product();
    expect(
      await failure(move({ type: 'ADJUSTMENT_OUT', productId: id, warehouseId, quantity: '1' })),
    ).toBe('INSUFFICIENT_STOCK');
    // The refusal rolled back the level it created, so nothing is left behind.
    expect(await ledger(id)).toEqual([]);

    await move({ type: 'ADJUSTMENT_IN', productId: id, warehouseId, quantity: '2', unitCost: '2' });
    expect(
      await failure(move({ type: 'ADJUSTMENT_OUT', productId: id, warehouseId, quantity: '3' })),
    ).toBe('INSUFFICIENT_STOCK');
  });

  it('allows negative stock when the company says so, at the last average', async () => {
    const id = await product();
    await setRule('ALLOW');
    try {
      const { level } = await move({
        type: 'ADJUSTMENT_OUT',
        productId: id,
        warehouseId,
        quantity: '5',
      });
      // No stock yet: the product's cost of 2 is the average.
      expect(level).toMatchObject({ onHand: '-5.000000', value: '-10.000000' });
      const after = await move({
        type: 'PURCHASE_RECEIPT',
        productId: id,
        warehouseId,
        quantity: '8',
        unitCost: '3',
      });
      expect(after.level).toMatchObject({
        onHand: '3.000000',
        value: '9.000000',
        averageCost: '3.000000',
      });
    } finally {
      await setRule('BLOCK');
    }
  });

  it('moves only goods that track stock, and only with the Inventario module', async () => {
    const plain = await product({ tracksStock: false });
    expect(
      await failure(
        move({
          type: 'ADJUSTMENT_IN',
          productId: plain,
          warehouseId,
          quantity: '1',
          unitCost: '1',
        }),
      ),
    ).toBe('PRODUCT_NOT_STOCKED');
    const service = await product({ kind: 'SERVICE' });
    expect(
      await failure(
        move({
          type: 'ADJUSTMENT_IN',
          productId: service,
          warehouseId,
          quantity: '1',
          unitCost: '1',
        }),
      ),
    ).toBe('PRODUCT_NOT_STOCKED');

    const id = await product();
    const actor = await owner();
    const without: ActorContext = {
      ...actor,
      entitlements: {
        ...actor.entitlements,
        features: actor.entitlements.features.filter((key) => key !== 'INVENTORY'),
      },
    };
    expect(
      await failure(
        move(
          { type: 'ADJUSTMENT_IN', productId: id, warehouseId, quantity: '1', unitCost: '1' },
          without,
        ),
      ),
    ).toBe('FEATURE_NOT_ENABLED');
  });

  it('lets only one of two simultaneous outflows take the last units', async () => {
    const id = await product();
    await move({
      type: 'ADJUSTMENT_IN',
      productId: id,
      warehouseId,
      quantity: '10',
      unitCost: '1',
    });
    const results = await Promise.allSettled([
      move({ type: 'ADJUSTMENT_OUT', productId: id, warehouseId, quantity: '6' }),
      move({ type: 'ADJUSTMENT_OUT', productId: id, warehouseId, quantity: '6' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect((refused as PromiseRejectedResult).reason).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('never changes a movement once written', async () => {
    const id = await product();
    await move({ type: 'ADJUSTMENT_IN', productId: id, warehouseId, quantity: '1', unitCost: '1' });
    const attempt = db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx
        .update(schema.stockMovements)
        .set({ quantity: '100' })
        .where(eq(schema.stockMovements.productId, id)),
    );
    await expect(attempt).rejects.toThrow();
  });

  it('keeps a company and its twin apart', async () => {
    const id = await product();
    await move({ type: 'ADJUSTMENT_IN', productId: id, warehouseId, quantity: '4', unitCost: '1' });
    const seen = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx.select().from(schema.stockLevels).where(eq(schema.stockLevels.productId, id)),
    );
    expect(seen).toEqual([]);
  });
});
