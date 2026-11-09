import { randomUUID } from 'node:crypto';
import {
  addModule,
  cancelSaleOrder,
  checkAuthorization,
  confirmSaleOrder,
  correctInvoice,
  correctOrderInvoice,
  createClient,
  createGuide,
  createJobs,
  createKeyCipher,
  createMockSri,
  createProduct,
  createSaleOrder,
  createSriClient,
  companySettings,
  fixedClock,
  getDocument,
  getSaleOrder,
  invoiceSaleOrder,
  onboardOrganization,
  orderInvoiceDraft,
  resolveActor,
  saleOrderGuides,
  saleOrderInvoices,
  sendDocument,
  setIssuePointDocumentType,
  setOpeningBalance,
  setOverride,
  updateSaleOrder,
  verifyStockLevels,
  voidDocument,
  type ActorContext,
  type CreatedOrganization,
  type IssueDeps,
  type Jobs,
  type MockSri,
  type OrderInvoiceInput,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { and, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-SAL-3, FR-SAL-4, FR-SAL-6, FR-SAL-7, FR-SAL-5 (ADR-022): invoicing a sale order in parts.
describe('invoicing a sale order', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('c5'.repeat(32));
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
  const owner = (): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: tenantId(), clock });
  const ref = (document: { id: string }) => ({ tenantId: tenantId(), documentId: document.id });

  const product = async (opening = '10') => {
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
      return row && { onHand: row.onHand, reserved: row.reserved };
    });
  // A confirmed order of `quantity` units at 5.00, with `discount` over the line.
  const order = async (productId: string, quantity = '10', discount = '0') => {
    const actor = await owner();
    const created = await createSaleOrder(actor, db, {
      clientId,
      warehouseId,
      lines: [{ productId, quantity, unitPrice: '5', discount }],
    });
    await confirmSaleOrder(actor, db, created.id);
    return created;
  };
  const view = async (orderId: string) => getSaleOrder(await owner(), db, orderId);
  // Total with 15 % IVA, for a payment that has to match.
  const payment = (base: number) => [{ method: '01' as const, amount: (base * 1.15).toFixed(2) }];
  const invoice = async (
    orderId: string,
    lineId: string,
    quantity: string,
    amount = Number(quantity) * 5,
    extra: Partial<OrderInvoiceInput> = {},
  ) =>
    invoiceSaleOrder(
      await owner(),
      db,
      {
        orderId,
        issuePointId: pointId,
        lines: [{ orderLineId: lineId, quantity }],
        payments: payment(amount),
        ...extra,
      },
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
      .values({ name: 'Owner', email: `soi.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Chi S.A.',
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
    await addModule(admin, db, { realTenantId: org.realTenantId, moduleKey: 'SALES' });
    await setOverride(admin, db, {
      realTenantId: org.realTenantId,
      featureKey: 'INVENTORY',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    await setOverride(admin, db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOC_TYPE_06',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    const real = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
    await setIssuePointDocumentType(real, db, {
      issuePointId: (await companySettings(real, db)).branches[0]!.issuePoints[0]!.id,
      documentType: '06',
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

  it('invoices 10 units as 4 + 6: the order is INVOICED once both are authorized, and stock is right', async () => {
    const coffee = await product();
    const created = await order(coffee);
    const lineId = (await view(created.id)).lines[0]!.id;
    expect(await level(coffee)).toEqual({ onHand: '10.000000', reserved: '10.000000' });

    const first = await invoice(created.id, lineId, '4');
    // The order's hold passes to the invoice: still 10 held in all.
    expect(await level(coffee)).toEqual({ onHand: '10.000000', reserved: '10.000000' });
    expect(await view(created.id)).toMatchObject({
      status: 'PARTIALLY_INVOICED',
      lines: [expect.objectContaining({ invoiced: '4.000000', left: '6.000000' })],
    });
    await authorize(first);
    expect(await level(coffee)).toEqual({ onHand: '6.000000', reserved: '6.000000' });
    expect((await view(created.id)).status).toBe('PARTIALLY_INVOICED');

    const second = await invoice(created.id, lineId, '6');
    // Fully covered, but only authorized invoices finish an order.
    expect(await view(created.id)).toMatchObject({
      status: 'PARTIALLY_INVOICED',
      lines: [expect.objectContaining({ invoiced: '10.000000', left: '0.000000' })],
    });
    await authorize(second);
    expect(await view(created.id)).toMatchObject({ status: 'INVOICED' });
    expect(await level(coffee)).toEqual({ onHand: '0.000000', reserved: '0.000000' });

    const invoices = await saleOrderInvoices(await owner(), db, created.id);
    expect(invoices.map((row) => [row.status, row.total])).toEqual([
      ['AUTHORIZED', '23.00'],
      ['AUTHORIZED', '34.50'],
    ]);
    expect((await getDocument(await owner(), db, first.id)).saleOrder).toMatchObject({
      id: created.id,
      number: created.number,
    });
  });

  it('refuses more than is left, a repeated or unknown line, and an order that is not confirmed', async () => {
    const coffee = await product();
    const created = await order(coffee, '5');
    const lineId = (await view(created.id)).lines[0]!.id;
    await invoice(created.id, lineId, '3');
    expect(await failure(invoice(created.id, lineId, '3'))).toBe('ORDER_QUANTITY_EXCEEDED');
    expect(await failure(invoice(created.id, randomUUID(), '1'))).toBe('ORDER_LINE_UNKNOWN');
    expect(
      await failure(
        invoiceSaleOrder(
          await owner(),
          db,
          {
            orderId: created.id,
            issuePointId: pointId,
            lines: [
              { orderLineId: lineId, quantity: '1' },
              { orderLineId: lineId, quantity: '1' },
            ],
            payments: payment(10),
          },
          issueDeps,
        ),
      ),
    ).toBe('ORDER_LINE_UNKNOWN');

    const draft = await createSaleOrder(await owner(), db, {
      clientId,
      warehouseId,
      lines: [{ productId: coffee, quantity: '1', unitPrice: '5', discount: '0' }],
    });
    const draftLine = (await view(draft.id)).lines[0]!.id;
    expect(await failure(invoice(draft.id, draftLine, '1'))).toBe('ORDER_NOT_INVOICEABLE');
  });

  it('shares a line discount so the parts add up to it', async () => {
    const coffee = await product();
    const created = await order(coffee, '3', '1');
    const lineId = (await view(created.id)).lines[0]!.id;
    // 5.00 less 0.33, 0.34 and 0.33; IVA 0.70 on each.
    for (const total of ['5.37', '5.36', '5.37']) {
      const document = await invoice(created.id, lineId, '1', 0, {
        payments: [{ method: '01' as const, amount: total }],
      });
      expect(document.total).toBe(total);
    }
    const ids = (await saleOrderInvoices(await owner(), db, created.id)).map((row) => row.id);
    const lines = await db.withTenant({ tenantId: tenantId() }, ({ db: tx }) =>
      tx
        .select({
          documentId: schema.documentLines.documentId,
          discount: schema.documentLines.discount,
        })
        .from(schema.documentLines),
    );
    expect(ids.map((id) => lines.find((line) => line.documentId === id)!.discount)).toEqual([
      '0.33',
      '0.34',
      '0.33',
    ]);
  });

  it('retries with the same key without covering the order twice', async () => {
    const coffee = await product();
    const created = await order(coffee, '5');
    const lineId = (await view(created.id)).lines[0]!.id;
    const key = randomUUID();
    const first = await invoice(created.id, lineId, '2', 10, { idempotencyKey: key });
    const again = await invoice(created.id, lineId, '2', 10, { idempotencyKey: key });
    expect(again).toMatchObject({ id: first.id, created: false });
    expect((await view(created.id)).lines[0]!.invoiced).toBe('2.000000');
  });

  it('corrects a rejected invoice through its order, keeping its number', async () => {
    const coffee = await product();
    const created = await order(coffee, '10');
    const lineId = (await view(created.id)).lines[0]!.id;
    const document = await invoice(created.id, lineId, '4');
    await sendDocument(deps, ref(document));
    mock.queue('authorization', { kind: 'notAuthorized', code: '46', message: 'RUC no existe' });
    await checkAuthorization(deps, ref(document));
    // Rejected, it keeps its quantities and its goods.
    expect(await view(created.id)).toMatchObject({
      status: 'PARTIALLY_INVOICED',
      lines: [expect.objectContaining({ invoiced: '4.000000' })],
    });

    // The invoice's own form can't change what an order covers.
    expect(
      await failure(
        correctInvoice(
          await owner(),
          db,
          document.id,
          {
            clientId,
            lines: [{ code: 'X', name: 'X', quantity: '1', unitPrice: '5', ivaRateCode: '4' }],
            payments: payment(5),
          },
          issueDeps,
        ),
      ),
    ).toBe('INVOICE_FROM_ORDER');

    const corrected = await correctOrderInvoice(
      await owner(),
      db,
      document.id,
      { lines: [{ orderLineId: lineId, quantity: '3' }], payments: payment(15) },
      issueDeps,
    );
    expect(corrected).toMatchObject({
      id: document.id,
      sequential: document.sequential,
      total: '17.25',
    });
    expect(await view(created.id)).toMatchObject({
      lines: [expect.objectContaining({ invoiced: '3.000000', left: '7.000000' })],
    });
    // 3 held by the invoice, 7 by the order.
    expect(await level(coffee)).toEqual({ onHand: '10.000000', reserved: '10.000000' });
    // It can take what its own old content held: 4 again, of the 10.
    mock.queue('authorization', { kind: 'notAuthorized', code: '46', message: 'RUC no existe' });
    await sendDocument(deps, ref(corrected));
    await checkAuthorization(deps, ref(corrected));
    await correctOrderInvoice(
      await owner(),
      db,
      document.id,
      { lines: [{ orderLineId: lineId, quantity: '10' }], payments: payment(50) },
      issueDeps,
    );
    expect((await view(created.id)).lines[0]).toMatchObject({
      invoiced: '10.000000',
      left: '0.000000',
    });
    await authorize(corrected);
    expect(await view(created.id)).toMatchObject({ status: 'INVOICED' });
    expect(await level(coffee)).toEqual({ onHand: '0.000000', reserved: '0.000000' });
  });

  it('takes the total as the payment when a single payment gives none, and offers the draft to correct', async () => {
    const coffee = await product();
    const created = await order(coffee, '3', '1');
    const lineId = (await view(created.id)).lines[0]!.id;
    const actor = await owner();
    const document = await invoiceSaleOrder(
      actor,
      db,
      {
        orderId: created.id,
        issuePointId: pointId,
        lines: [{ orderLineId: lineId, quantity: '2' }],
        // 10.00 less 0.67, IVA 1.40: no amount typed.
        payments: [{ method: '01', term: 30, termUnit: 'dias' }],
      },
      issueDeps,
    );
    expect(document.total).toBe('10.73');
    expect(
      await failure(
        invoiceSaleOrder(
          actor,
          db,
          {
            orderId: created.id,
            issuePointId: pointId,
            lines: [{ orderLineId: lineId, quantity: '1' }],
            payments: [{ method: '01' }, { method: '01' }],
          },
          issueDeps,
        ),
      ),
    ).toBe('PAYMENT_AMOUNT_REQUIRED');

    await sendDocument(deps, ref(document));
    mock.queue('authorization', { kind: 'notAuthorized', code: '46', message: 'RUC no existe' });
    await checkAuthorization(deps, ref(document));
    const draft = await orderInvoiceDraft(actor, db, document.id);
    expect(draft).toMatchObject({
      number: document.number,
      order: { id: created.id },
      payments: [{ method: '01', amount: '10.73', term: 30, termUnit: 'dias' }],
    });
    expect(draft.lines).toEqual([
      expect.objectContaining({ orderLineId: lineId, current: '2.000000', left: '3.000000' }),
    ]);
  });

  it('locks the order while invoices cover it, and gives the quantities back when one is voided', async () => {
    const coffee = await product();
    const created = await order(coffee, '10');
    const lineId = (await view(created.id)).lines[0]!.id;
    const first = await invoice(created.id, lineId, '4');
    const second = await invoice(created.id, lineId, '6');
    const actor = await owner();
    expect(
      await failure(
        updateSaleOrder(actor, db, created.id, {
          clientId,
          warehouseId,
          lines: [{ productId: coffee, quantity: '10', unitPrice: '5', discount: '0' }],
        }),
      ),
    ).toBe('ORDER_NOT_EDITABLE');
    expect(await failure(cancelSaleOrder(actor, db, { id: created.id, reason: 'No' }))).toBe(
      'INVALID_TRANSITION',
    );
    await authorize(first);
    await authorize(second);
    expect((await view(created.id)).status).toBe('INVOICED');
    expect(await level(coffee)).toEqual({ onHand: '0.000000', reserved: '0.000000' });

    // Void the 6: goods come back and the order holds them again (FR-SAL-4).
    mock.void(second.accessKey);
    await voidDocument(await owner(), db, second.id, {}, { sri: deps.sri });
    expect(await view(created.id)).toMatchObject({
      status: 'PARTIALLY_INVOICED',
      lines: [expect.objectContaining({ invoiced: '4.000000', left: '6.000000' })],
    });
    expect(await level(coffee)).toEqual({ onHand: '6.000000', reserved: '6.000000' });

    // And the order can be invoiced for them again.
    const third = await invoice(created.id, lineId, '6');
    await authorize(third);
    expect((await view(created.id)).status).toBe('INVOICED');
    expect(await level(coffee)).toEqual({ onHand: '0.000000', reserved: '0.000000' });

    // Voiding both leaves the order as it was confirmed, holding all 10.
    mock.void(first.accessKey);
    mock.void(third.accessKey);
    await voidDocument(await owner(), db, first.id, {}, { sri: deps.sri });
    await voidDocument(await owner(), db, third.id, {}, { sri: deps.sri });
    expect(await view(created.id)).toMatchObject({ status: 'CONFIRMED' });
    expect(await level(coffee)).toEqual({ onHand: '10.000000', reserved: '10.000000' });
    // Nothing covers it now: it can be cancelled, which lets the goods go.
    await cancelSaleOrder(await owner(), db, { id: created.id, reason: 'Ya no' });
    expect(await level(coffee)).toEqual({ onHand: '10.000000', reserved: '0.000000' });
  });

  it('needs the sales permissions and the feature', async () => {
    const coffee = await product();
    const created = await order(coffee, '2');
    const lineId = (await view(created.id)).lines[0]!.id;
    const actor = await owner();
    expect(
      await failure(
        invoiceSaleOrder(
          { ...actor, permissions: actor.permissions.filter((key) => key !== 'sales.manage') },
          db,
          {
            orderId: created.id,
            issuePointId: pointId,
            lines: [{ orderLineId: lineId, quantity: '1' }],
            payments: payment(5),
          },
          issueDeps,
        ),
      ),
    ).toBe('FORBIDDEN');
  });

  it("lists the guías that go with the order's invoices, and the guía names the order (FR-SAL-9)", async () => {
    const coffee = await product();
    const created = await order(coffee, '6');
    const lineId = (await view(created.id)).lines[0]!.id;
    const first = await invoice(created.id, lineId, '2');
    const second = await invoice(created.id, lineId, '4');
    const actor = await owner();
    expect(await saleOrderGuides(actor, db, created.id)).toEqual([]);
    const guideFor = (originId: string) =>
      createGuide(
        actor,
        db,
        {
          issuePointId: pointId,
          originId,
          departureAddress: 'Quito',
          carrier: {
            idType: '04',
            identification: '1790012345001',
            name: 'Transportes Andes S.A.',
          },
          transportStart: '2026-11-10',
          transportEnd: '2026-11-11',
          plate: 'PCQ-1234',
          recipients: [
            {
              identification: '1710034065',
              name: 'María López',
              address: 'Guayaquil',
              reason: 'Venta',
              lines: [{ name: 'Café molido', code: 'A', quantity: '2' }],
            },
          ],
        },
        issueDeps,
      );
    // A guía goes with an invoice that isn't voided, authorized or not.
    const guideOne = await guideFor(first.id);
    const guideTwo = await guideFor(second.id);
    expect((await saleOrderGuides(actor, db, created.id)).map((row) => row.id)).toEqual([
      guideOne.id,
      guideTwo.id,
    ]);
    expect((await getDocument(actor, db, guideOne.id)).saleOrder).toMatchObject({
      id: created.id,
      number: created.number,
    });
    // One from an invoice of another order isn't listed.
    const other = await order(await product(), '1');
    const otherInvoice = await invoice(other.id, (await view(other.id)).lines[0]!.id, '1');
    await guideFor(otherInvoice.id);
    expect(await saleOrderGuides(actor, db, created.id)).toHaveLength(2);
  });

  it('leaves every level equal to its ledger', async () => {
    const { drifts } = await verifyStockLevels({ db, logger: testLogger() });
    expect(drifts.filter((drift) => drift.tenantId === tenantId())).toEqual([]);
  });
});
