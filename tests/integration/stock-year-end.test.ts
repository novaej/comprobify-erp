import { randomUUID } from 'node:crypto';
import {
  adjustStock,
  createKeyCipher,
  createProduct,
  ecuadorDate,
  fixedClock,
  importStockCount,
  listAuditEvents,
  onboardOrganization,
  productStock,
  resolveActor,
  setOpeningBalance,
  setOverride,
  stockValuation,
  verifyStockLevels,
  type ActorContext,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, ownerDatabase, superAdmin, testLogger } from './helpers';

// ADR-046, FR-INV-3, FR-INV-5: the valuation on a past day and the physical count.
describe('stock at year end', () => {
  // The database stamps movements with its own time, so the past day is set back from today.
  const clock = fixedClock(new Date().toISOString());
  const today = ecuadorDate(clock.now());
  let db: Database;
  let owner: Database;
  let org: CreatedOrganization;
  let actor: ActorContext;
  let warehouseId: string;

  const product = async (code: string) =>
    (
      await createProduct(actor, db, {
        code,
        name: `Producto ${code}`,
        kind: 'GOOD',
        price: '5',
        cost: '2',
        ivaRateCode: '4',
        tracksStock: true,
      })
    ).id;
  // The ledger is append-only for the app; only the owner can date a movement in the past.
  const dateMovements = (productId: string, at: string) =>
    owner.withSystem('test: date movements', ({ db: tx }) =>
      tx
        .update(schema.stockMovements)
        .set({ createdAt: new Date(at) })
        .where(eq(schema.stockMovements.productId, productId)),
    );

  beforeAll(async () => {
    db = appDatabase();
    owner = ownerDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `ye.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: 'Cierre S.A.',
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
      { keyCipher: createKeyCipher('ab'.repeat(32)), clock },
    );
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'INVENTORY',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    actor = await resolveActor(db, { userId: user!.id, tenantId: org.twinTenantId, clock });
    const [warehouse] = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx.select().from(schema.warehouses),
    );
    warehouseId = warehouse!.id;
  });
  afterAll(async () => {
    await db.close();
    await owner.close();
  });

  it('values the stock as it was at the end of a past day', async () => {
    const coffee = await product('YE-CAF');
    await setOpeningBalance(actor, db, {
      productId: coffee,
      warehouseId,
      quantity: '10',
      unitCost: '2',
    });
    // 30 December 2025, Quito: 10 at 2.00. Then, today, 4 more at 5.00.
    await dateMovements(coffee, '2025-12-30T20:00:00Z');
    await adjustStock(actor, db, {
      productId: coffee,
      warehouseId,
      direction: 'IN',
      quantity: '4',
      unitCost: '5',
      reason: 'Compra',
    });
    const yearEnd = await stockValuation(actor, db, { asOf: '2025-12-31' });
    expect(yearEnd.asOf).toBe('2025-12-31');
    expect(yearEnd.lines.find((line) => line.code === 'YE-CAF')).toMatchObject({
      onHand: '10',
      averageCost: '2.000000',
      value: '20.00',
    });
    const now = await stockValuation(actor, db);
    expect(now.asOf).toBe(today);
    expect(now.lines.find((line) => line.code === 'YE-CAF')).toMatchObject({
      onHand: '14',
      value: '40.00',
    });
    // Before anything moved there is nothing; a future or odd date reads as today.
    expect(
      (await stockValuation(actor, db, { asOf: '2025-12-01' })).lines.some(
        (line) => line.code === 'YE-CAF',
      ),
    ).toBe(false);
    expect((await stockValuation(actor, db, { asOf: '2999-01-01' })).asOf).toBe(today);
    expect((await stockValuation(actor, db, { asOf: 'yesterday' })).asOf).toBe(today);
  });

  it('adjusts the books to a count, whole or not at all, with the reason', async () => {
    const tea = await product('YE-TE');
    const sugar = await product('YE-AZ');
    const salt = await product('YE-SAL');
    for (const id of [tea, sugar, salt])
      await setOpeningBalance(actor, db, {
        productId: id,
        warehouseId,
        quantity: '10',
        unitCost: '3',
      });

    // A bad line refuses the whole file.
    const refused = await importStockCount(
      actor,
      db,
      'codigo;contado\nYE-TE;12\nNO-EXISTE;1\nYE-AZ;-1\n',
      { reason: 'Conteo físico 2026' },
    );
    expect(refused).toMatchObject({
      adjusted: 0,
      problems: [
        { line: 3, code: 'PRODUCT_NOT_FOUND' },
        { line: 4, code: 'QUANTITY_INVALID' },
      ],
    });
    expect((await productStock(actor, db, tea)).total.onHand).toBe('10');

    const applied = await importStockCount(
      actor,
      db,
      'codigo;contado\nYE-TE;12\nYE-AZ;7,5\nYE-SAL;10\n',
      { reason: 'Conteo físico 2026' },
    );
    expect(applied).toEqual({ adjusted: 2, unchanged: 1, problems: [] });
    expect((await productStock(actor, db, tea)).total).toMatchObject({ onHand: '12' });
    expect((await productStock(actor, db, sugar)).total).toMatchObject({ onHand: '7.5' });
    expect((await productStock(actor, db, salt)).total).toMatchObject({ onHand: '10' });
    const movements = (await productStock(actor, db, sugar)).movements;
    expect(movements[0]).toMatchObject({ type: 'ADJUSTMENT_OUT', reason: 'Conteo físico 2026' });
    expect((await verifyStockLevels({ db, logger: testLogger() })).drifts).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ productId: sugar })]),
    );
    const events = await listAuditEvents(actor, db, { category: 'OPERATIONS' });
    expect(events.find((event) => event.action === 'stock.counted')).toMatchObject({
      details: { lines: 3, adjusted: 2, found: 1, missing: 1, reason: 'Conteo físico 2026' },
    });
  });

  it('asks for a reason', async () => {
    await expect(
      importStockCount(actor, db, 'codigo;contado\nYE-TE;12\n', { reason: ' ' }),
    ).rejects.toThrow();
  });
});
