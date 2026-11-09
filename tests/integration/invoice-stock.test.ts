import { randomUUID } from 'node:crypto';
import {
  adjustStock,
  checkAuthorization,
  companySettings,
  correctInvoice,
  createClient,
  createCreditNote,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createProduct,
  createSriClient,
  creditBalance,
  fixedClock,
  onboardOrganization,
  resolveActor,
  sendDocument,
  setIssuePointDocumentType,
  setNegativeStockRule,
  setOpeningBalance,
  setOverride,
  verifyStockLevels,
  voidDocument,
  type ActorContext,
  type CreatedOrganization,
  type InvoiceInput,
  type IssueDeps,
  type IssuedDocument,
  type Jobs,
  type MockSri,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { and, asc, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// ADR-020, FR-INV-1, FR-INV-2, FR-INV-4, FR-SAL-2, FR-SAL-8: what invoices and credit notes
// do to stock.
describe('invoices and credit notes move stock', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('c4'.repeat(32));
  let db: Database;
  let jobs: Jobs;
  let mock: MockSri;
  let deps: SendingDeps;
  let issueDeps: IssueDeps;
  let org: CreatedOrganization;
  let ownerId: string;
  let clientId: string;
  let pointId: string;
  let warehouseId: string;

  const tenantId = () => org.twinTenantId;
  const owner = () => resolveActor(db, { userId: ownerId, tenantId: tenantId(), clock });
  const ref = (document: { id: string }) => ({ tenantId: tenantId(), documentId: document.id });

  // A good with `opening` units at 2.00 each.
  const product = async (opening: string | null = '10') => {
    const actor = await owner();
    const { id } = await createProduct(actor, db, {
      code: `P-${randomUUID().slice(0, 8)}`,
      name: 'Café molido',
      kind: 'GOOD',
      price: '5',
      cost: '2',
      ivaRateCode: '4',
      tracksStock: true,
    });
    if (opening)
      await setOpeningBalance(actor, db, {
        productId: id,
        warehouseId,
        quantity: opening,
        unitCost: '2',
      });
    return id;
  };
  const level = (productId: string) =>
    db.withTenant({ tenantId: tenantId() }, async ({ db: tx }) => {
      const [row] = await tx
        .select()
        .from(schema.stockLevels)
        .where(
          and(
            eq(schema.stockLevels.productId, productId),
            eq(schema.stockLevels.warehouseId, warehouseId),
          ),
        );
      return row && { onHand: row.onHand, reserved: row.reserved, value: row.value };
    });
  const movements = (productId: string) =>
    db.withTenant({ tenantId: tenantId() }, ({ db: tx }) =>
      tx
        .select({
          type: schema.stockMovements.type,
          quantity: schema.stockMovements.quantity,
          reserved: schema.stockMovements.reserved,
          unitCost: schema.stockMovements.unitCost,
          sourceId: schema.stockMovements.sourceId,
        })
        .from(schema.stockMovements)
        .where(eq(schema.stockMovements.productId, productId))
        .orderBy(asc(schema.stockMovements.createdAt), asc(schema.stockMovements.id)),
    );
  const content = (
    lines: { productId: string | null; quantity: string }[],
  ): Omit<InvoiceInput, 'issuePointId'> => {
    const total = lines.reduce((sum, line) => sum + Number(line.quantity) * 5, 0) * 1.15;
    return {
      clientId,
      lines: lines.map((line, index) => ({
        productId: line.productId,
        code: `L-${index}`,
        name: 'Café molido',
        quantity: line.quantity,
        unitPrice: '5',
        ivaRateCode: '4',
      })),
      payments: [{ method: '01', amount: total.toFixed(2) }],
    };
  };
  const invoice = async (
    lines: { productId: string | null; quantity: string }[],
    actor?: ActorContext,
  ) =>
    createInvoice(
      actor ?? (await owner()),
      db,
      { issuePointId: pointId, ...content(lines) },
      issueDeps,
    );
  const authorize = async (document: { id: string }) => {
    await sendDocument(deps, ref(document));
    await checkAuthorization(deps, ref(document));
  };
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const creditNote = async (origin: IssuedDocument, quantity: string, returnStock: boolean) =>
    createCreditNote(
      await owner(),
      db,
      {
        issuePointId: pointId,
        originId: origin.id,
        reason: 'Devolución de mercadería',
        lines: [{ sourcePosition: 1, quantity }],
        returnStock,
      },
      issueDeps,
    );

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    issueDeps = {
      jobs,
      keyCipher,
      appEnv: 'local',
      providerRuc: '1712345678001',
      consumerFinalMaxAmount: '50.00',
    };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `is.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Psi S.A.',
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
    const admin = await superAdmin(db);
    for (const featureKey of ['INVENTORY', 'DOC_TYPE_04'])
      await setOverride(admin, db, {
        realTenantId: org.realTenantId,
        featureKey,
        effect: 'GRANT',
        limitValue: null,
        reason: 'test',
      });
    const real = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
    await setIssuePointDocumentType(real, db, {
      issuePointId: (await companySettings(real, db)).branches[0]!.issuePoints[0]!.id,
      documentType: '04',
      enabled: true,
    });
    pointId = (await companySettings(await owner(), db)).branches[0]!.issuePoints[0]!.id;
    const [warehouse] = await db.withTenant({ tenantId: tenantId() }, ({ db: tx }) =>
      tx.select().from(schema.warehouses),
    );
    warehouseId = warehouse!.id;
    clientId = (
      await createClient(await owner(), db, {
        idType: '05',
        identification: '1710034065',
        name: 'María López',
        emails: ['maria@example.com'],
      })
    ).id;
  });

  beforeEach(() => {
    clock.set('2026-11-10T15:00:00Z');
    mock = createMockSri({ now: () => clock.now() });
    deps = {
      db,
      sri: createSriClient({ transport: mock.transport }),
      jobs,
      clock,
      logger: testLogger(),
    };
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('holds the goods when the invoice is made and sells them when SRI authorizes it', async () => {
    const coffee = await product();
    const document = await invoice([
      { productId: coffee, quantity: '3' },
      { productId: coffee, quantity: '1' },
      // A line typed by hand moves nothing.
      { productId: null, quantity: '1' },
    ]);
    expect(await level(coffee)).toEqual({
      onHand: '10.000000',
      reserved: '4.000000',
      value: '20.000000',
    });
    await authorize(document);
    expect(await level(coffee)).toEqual({
      onHand: '6.000000',
      reserved: '0.000000',
      value: '12.000000',
    });
    expect(await movements(coffee)).toEqual([
      expect.objectContaining({ type: 'OPENING_BALANCE' }),
      expect.objectContaining({ type: 'RESERVATION', quantity: '0.000000', reserved: '4.000000' }),
      expect.objectContaining({
        type: 'SALE',
        quantity: '-4.000000',
        reserved: '-4.000000',
        unitCost: '2.000000',
        sourceId: document.id,
      }),
    ]);
  });

  it('refuses an invoice for more than is free, unless the company allows negative stock', async () => {
    const coffee = await product('5');
    await invoice([{ productId: coffee, quantity: '3' }]);
    // 5 on hand, 3 held: 2 are free.
    expect(await failure(invoice([{ productId: coffee, quantity: '3' }]))).toBe(
      'INSUFFICIENT_STOCK',
    );
    const actor = await owner();
    await setNegativeStockRule(
      await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock }),
      db,
      'ALLOW',
    );
    try {
      const allowed = await invoice([{ productId: coffee, quantity: '3' }], actor);
      await authorize(allowed);
      expect(await level(coffee)).toMatchObject({ onHand: '2.000000', reserved: '3.000000' });
    } finally {
      await setNegativeStockRule(
        await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock }),
        db,
        'BLOCK',
      );
    }
  });

  it('moves nothing without Inventario, and nothing for a product with no stock', async () => {
    const coffee = await product();
    const actor = await owner();
    const without = {
      ...actor,
      entitlements: {
        ...actor.entitlements,
        features: actor.entitlements.features.filter((key) => key !== 'INVENTORY'),
      },
    };
    await authorize(await invoice([{ productId: coffee, quantity: '2' }], without));
    expect(await level(coffee)).toMatchObject({ onHand: '10.000000', reserved: '0.000000' });

    const service = (
      await createProduct(actor, db, {
        code: `S-${randomUUID().slice(0, 8)}`,
        name: 'Instalación',
        kind: 'SERVICE',
        price: '5',
        ivaRateCode: '4',
      })
    ).id;
    await authorize(await invoice([{ productId: service, quantity: '1' }]));
    expect(await movements(service)).toEqual([]);
  });

  it('holds the corrected lines instead of the returned ones', async () => {
    const coffee = await product();
    const tea = await product();
    const document = await invoice([{ productId: coffee, quantity: '4' }]);
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await sendDocument(deps, ref(document));
    // Returned by SRI: the goods stay held until it is corrected (FR-SAL-4).
    expect(await level(coffee)).toMatchObject({ reserved: '4.000000' });
    await correctInvoice(
      await owner(),
      db,
      document.id,
      content([
        { productId: coffee, quantity: '1' },
        { productId: tea, quantity: '2' },
      ]),
      issueDeps,
    );
    expect(await level(coffee)).toMatchObject({ onHand: '10.000000', reserved: '1.000000' });
    expect(await level(tea)).toMatchObject({ reserved: '2.000000' });
    await authorize(document);
    expect(await level(coffee)).toMatchObject({ onHand: '9.000000', reserved: '0.000000' });
    expect(await level(tea)).toMatchObject({ onHand: '8.000000', reserved: '0.000000' });
  });

  it('brings goods back with a credit note, at the cost they left at, and takes them out if it is voided', async () => {
    const coffee = await product();
    const origin = await invoice([{ productId: coffee, quantity: '4' }]);
    await authorize(origin);
    // The average moves after the sale (6 at 2.00 and 2 at 5.00: 2.75); a return still comes
    // back at the 2.00 it left at.
    await adjustStock(await owner(), db, {
      productId: coffee,
      warehouseId,
      direction: 'IN',
      quantity: '2',
      unitCost: '5',
      reason: 'Compra sin orden',
    });
    expect((await creditBalance(await owner(), db, origin.id)).canReturnStock).toBe(true);

    // Without the switch, nothing comes back.
    await authorize(await creditNote(origin, '1', false));
    expect(await level(coffee)).toMatchObject({ onHand: '8.000000' });

    const note = await creditNote(origin, '2', true);
    expect(await level(coffee)).toMatchObject({ onHand: '8.000000' });
    await authorize(note);
    expect(await level(coffee)).toEqual({
      onHand: '10.000000',
      reserved: '0.000000',
      value: '26.000000',
    });
    expect((await movements(coffee)).at(-1)).toMatchObject({
      type: 'RETURN_IN',
      quantity: '2.000000',
      unitCost: '2.000000',
      sourceId: note.id,
    });

    // Voided at SRI: the return goes back out.
    mock.void(note.accessKey);
    await voidDocument(await owner(), db, note.id, {}, { sri: deps.sri });
    // Out at the average, 2.60.
    expect(await level(coffee)).toMatchObject({ onHand: '8.000000', value: '20.800000' });
    expect((await movements(coffee)).at(-1)).toMatchObject({
      type: 'ADJUSTMENT_OUT',
      quantity: '-2.000000',
      sourceId: note.id,
    });
  });

  it('gets back on void only what the credit notes have not', async () => {
    const coffee = await product();
    const origin = await invoice([{ productId: coffee, quantity: '4' }]);
    await authorize(origin);
    await authorize(await creditNote(origin, '3', true));
    expect(await level(coffee)).toMatchObject({ onHand: '9.000000' });
    expect((await creditBalance(await owner(), db, origin.id)).canReturnStock).toBe(true);

    mock.void(origin.accessKey);
    await voidDocument(await owner(), db, origin.id, {}, { sri: deps.sri });
    expect(await level(coffee)).toEqual({
      onHand: '10.000000',
      reserved: '0.000000',
      value: '20.000000',
    });
    expect((await movements(coffee)).at(-1)).toMatchObject({
      type: 'RETURN_IN',
      quantity: '1.000000',
      sourceId: origin.id,
    });
  });

  it('refuses a stock return without Inventario', async () => {
    const coffee = await product();
    const origin = await invoice([{ productId: coffee, quantity: '1' }]);
    await authorize(origin);
    const actor = await owner();
    const without = {
      ...actor,
      entitlements: {
        ...actor.entitlements,
        features: actor.entitlements.features.filter((key) => key !== 'INVENTORY'),
      },
    };
    await expect(
      createCreditNote(
        without,
        db,
        {
          issuePointId: pointId,
          originId: origin.id,
          reason: 'Devolución',
          lines: [{ sourcePosition: 1, quantity: '1' }],
          returnStock: true,
        },
        issueDeps,
      ),
    ).rejects.toMatchObject({ code: 'FEATURE_NOT_ENABLED' });
  });

  it('leaves every level equal to its ledger', async () => {
    const { drifts } = await verifyStockLevels({ db, logger: testLogger() });
    expect(drifts.filter((drift) => drift.tenantId === tenantId())).toEqual([]);
  });
});
