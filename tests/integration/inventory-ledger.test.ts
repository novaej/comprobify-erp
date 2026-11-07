import { randomUUID } from 'node:crypto';
import {
  adjustStock,
  createBranch,
  listStock,
  productStock,
  stockValuation,
  applyMovement,
  importOpeningBalances,
  setOpeningBalance,
  updateProduct,
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
  const product = async (
    overrides: { tracksStock?: boolean; kind?: 'GOOD' | 'SERVICE'; code?: string } = {},
  ) =>
    (
      await createProduct(await owner(), db, {
        code: overrides.code ?? `P-${randomUUID().slice(0, 8)}`,
        name: 'Café molido',
        kind: overrides.kind ?? 'GOOD',
        price: '5',
        cost: '2',
        ivaRateCode: '4',
        tracksStock: overrides.tracksStock ?? overrides.kind !== 'SERVICE',
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

  // FR-INV-3.
  it('adjusts by hand with a reason, in at a cost or the average, out at the average', async () => {
    const id = await product();
    const actor = await owner();
    await adjustStock(actor, db, {
      productId: id,
      warehouseId,
      direction: 'IN',
      quantity: '4',
      unitCost: '3',
      reason: 'Encontrado en bodega',
    });
    // No cost: the found goods come in at the average.
    const found = await adjustStock(actor, db, {
      productId: id,
      warehouseId,
      direction: 'IN',
      quantity: '1',
      reason: 'Conteo',
    });
    expect(found.movement).toMatchObject({ type: 'ADJUSTMENT_IN', unitCost: '3.000000' });
    const lost = await adjustStock(actor, db, {
      productId: id,
      warehouseId,
      direction: 'OUT',
      quantity: '2',
      reason: 'Roto',
    });
    expect(lost.movement).toMatchObject({
      type: 'ADJUSTMENT_OUT',
      quantity: '-2.000000',
      reason: 'Roto',
    });
    expect(lost.level).toMatchObject({ onHand: '3.000000', value: '9.000000' });
    expect(
      await failure(
        adjustStock(actor, db, {
          productId: id,
          warehouseId,
          direction: 'OUT',
          quantity: '1',
          reason: ' ',
        }),
      ),
    ).not.toBe('it did not fail');
  });

  it('takes an opening balance only as the first movement of a level', async () => {
    const id = await product();
    const actor = await owner();
    await setOpeningBalance(actor, db, {
      productId: id,
      warehouseId,
      quantity: '7',
      unitCost: '1.5',
    });
    expect(
      await failure(
        setOpeningBalance(actor, db, { productId: id, warehouseId, quantity: '1', unitCost: '1' }),
      ),
    ).toBe('STOCK_ALREADY_MOVED');
  });

  it('imports opening balances from a spreadsheet, whole or not at all', async () => {
    const a = await product({ code: `IMP-A-${randomUUID().slice(0, 4)}` });
    const b = await product({ code: `IMP-B-${randomUUID().slice(0, 4)}` });
    const plain = await product({ code: `IMP-C-${randomUUID().slice(0, 4)}`, tracksStock: false });
    const codes = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx.select({ id: schema.products.id, code: schema.products.code }).from(schema.products),
    );
    const code = (id: string) => codes.find((row) => row.id === id)!.code;
    const actor = await owner();

    // Spanish Excel: semicolons and decimal commas. One bad line stops the whole file.
    const bad = await importOpeningBalances(
      actor,
      db,
      `Código;Sucursal;Cantidad;Costo unitario\n${code(a)};001;10;2,50\n${code(plain)};001;1;1\nNOPE;001;1;1\n${code(b)};009;1;1\n${code(a)};1;2;1\n`,
    );
    expect(bad).toEqual({
      imported: 0,
      problems: [
        { line: 3, code: 'PRODUCT_NOT_STOCKED' },
        { line: 4, code: 'PRODUCT_NOT_FOUND' },
        { line: 5, code: 'BRANCH_NOT_FOUND' },
        { line: 6, code: 'DUPLICATE_ROW' },
      ],
    });
    expect(await ledger(a)).toEqual([]);

    const good = await importOpeningBalances(
      actor,
      db,
      `code,quantity,unit_cost\n${code(a)},10,2.50\n${code(b)},3,1\n`,
    );
    expect(good).toEqual({ imported: 2, problems: [] });
    const [movement] = await ledger(a);
    expect(movement).toMatchObject({
      type: 'OPENING_BALANCE',
      quantity: '10.000000',
      value: '25.000000',
      sourceType: 'OPENING_IMPORT',
    });
    // Twice is refused: those levels have moved.
    expect(
      await importOpeningBalances(actor, db, `code,quantity,unit_cost\n${code(a)},1,1\n`),
    ).toEqual({ imported: 0, problems: [{ line: 2, code: 'STOCK_ALREADY_MOVED' }] });
    expect(await failure(importOpeningBalances(actor, db, 'name,price\nA,1\n'))).toBe(
      'IMPORT_COLUMNS',
    );
  });

  // FR-INV-6.
  it('keeps a product tracking stock while a warehouse holds it, and services never do', async () => {
    const id = await product();
    const actor = await owner();
    await adjustStock(actor, db, {
      productId: id,
      warehouseId,
      direction: 'IN',
      quantity: '1',
      unitCost: '1',
      reason: 'x',
    });
    const base = {
      code: `S-${randomUUID().slice(0, 8)}`,
      name: 'Café molido',
      kind: 'GOOD' as const,
      price: '5',
      ivaRateCode: '4',
    };
    expect(await failure(updateProduct(actor, db, id, { ...base, tracksStock: false }))).toBe(
      'STOCK_HELD',
    );
    await adjustStock(actor, db, {
      productId: id,
      warehouseId,
      direction: 'OUT',
      quantity: '1',
      reason: 'x',
    });
    await expect(
      updateProduct(actor, db, id, { ...base, tracksStock: false }),
    ).resolves.toMatchObject({
      tracksStock: false,
    });
    expect(
      await failure(
        createProduct(actor, db, {
          ...base,
          code: `S-${randomUUID().slice(0, 8)}`,
          kind: 'SERVICE',
          tracksStock: true,
        }),
      ),
    ).toBe('SERVICE_HAS_NO_STOCK');
  });

  // FR-INV-5. Last: it adds a second warehouse, which the import above doesn't expect.
  it('adds warehouses up, with the average of the sum, and values the stock per warehouse', async () => {
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'MAX_BRANCHES',
      effect: 'LIMIT',
      limitValue: 2,
      reason: 'test',
    });
    const real = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
    await createBranch(real, db, { code: '002', name: 'Norte', address: 'Quito' });
    const warehouses = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx.select().from(schema.warehouses),
    );
    const north = warehouses.find((warehouse) => warehouse.id !== warehouseId)!.id;

    const code = `MULTI-${randomUUID().slice(0, 6)}`;
    const id = await product({ code });
    await move({
      type: 'OPENING_BALANCE',
      productId: id,
      warehouseId,
      quantity: '10',
      unitCost: '2',
    });
    await move({
      type: 'OPENING_BALANCE',
      productId: id,
      warehouseId: north,
      quantity: '5',
      unitCost: '5',
    });

    const actor = await owner();
    const all = await listStock(actor, db, { query: code });
    expect(all.rows).toMatchObject([
      // (20 + 25) / 15
      { id, onHand: '15', available: '15', averageCost: '3.000000', value: '45.00' },
    ]);
    expect(all.warehouses).toHaveLength(2);
    const one = await listStock(actor, db, { query: code, warehouseId: north });
    expect(one.rows).toMatchObject([{ onHand: '5', averageCost: '5.000000', value: '25.00' }]);

    const detail = await productStock(actor, db, id);
    expect(
      detail.warehouses.map((warehouse) => [
        warehouse.branchCode,
        warehouse.onHand,
        warehouse.moved,
      ]),
    ).toEqual([
      ['001', '10', true],
      ['002', '5', true],
    ]);
    expect(detail.movementsTotal).toBe(2);
    expect(detail.total).toMatchObject({ onHand: '15', value: '45.00' });

    const valuation = await stockValuation(actor, db);
    expect(valuation.lines.filter((line) => line.code === code)).toMatchObject([
      { branchCode: '001', value: '20.00' },
      { branchCode: '002', value: '25.00' },
    ]);
    const sum = valuation.warehouses.reduce(
      (total, warehouse) => total + Number(warehouse.value),
      0,
    );
    expect(sum.toFixed(2)).toBe(valuation.total);
  });
});
