import { randomUUID } from 'node:crypto';
import {
  bulkQueueOverview,
  checkAuthorization,
  companySettings,
  completeBatches,
  confirmSaleOrder,
  createClient,
  createJobs,
  createKeyCipher,
  createMockSri,
  createProduct,
  createSaleOrder,
  createSriClient,
  fixedClock,
  getBatch,
  getSaleOrder,
  goLive,
  invoiceableOrderIds,
  invoiceOrderRemainder,
  listBatches,
  listInvoiceableOrders,
  onboardOrganization,
  processItem,
  resolveActor,
  retryFailedItems,
  sendDocument,
  setOpeningBalance,
  setOverride,
  startOrderBatch,
  type ActorContext,
  type BulkDeps,
  type CreatedOrganization,
  type IssueDeps,
  type Jobs,
  type MockSri,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-BULK-1, FR-BULK-2, FR-BULK-3 (ADR-026): batches of invoices made by the worker, one item
// at a time, with the quota cutting items off one by one.
describe('bulk invoicing', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('c7'.repeat(32));
  const PAYMENT = { method: '01' as const };
  let db: Database;
  let jobs: Jobs;
  let mock: MockSri;
  let sending: SendingDeps;
  let bulk: BulkDeps;
  let issueDeps: IssueDeps;
  let org: CreatedOrganization;
  let ownerId: string;

  type Company = { tenantId: string; pointId: string; warehouseId: string; clientId: string };
  let twin: Company;
  let real: Company;

  const actor = (company: Company): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: company.tenantId, clock });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };

  const company = async (tenantId: string): Promise<Company> => {
    const ctx = await resolveActor(db, { userId: ownerId, tenantId, clock });
    const [warehouse] = await db.withTenant({ tenantId }, ({ db: tx }) =>
      tx.select().from(schema.warehouses),
    );
    return {
      tenantId,
      pointId: (await companySettings(ctx, db)).branches[0]!.issuePoints[0]!.id,
      warehouseId: warehouse!.id,
      clientId: (
        await createClient(ctx, db, {
          idType: '05',
          identification: '1710034065',
          name: 'María López',
          emails: ['maria@example.com'],
        })
      ).id,
    };
  };
  const stocked = async (company_: Company, opening = '50') => {
    const ctx = await actor(company_);
    const { id } = await createProduct(ctx, db, {
      code: `P-${randomUUID().slice(0, 8)}`,
      name: 'Café molido',
      kind: 'GOOD',
      price: '5',
      cost: '2',
      ivaRateCode: '4',
      tracksStock: true,
    });
    await setOpeningBalance(ctx, db, {
      productId: id,
      warehouseId: company_.warehouseId,
      quantity: opening,
      unitCost: '2',
    });
    return id;
  };
  // Confirmed orders of one unit each, or drafts when asked.
  const orders = async (company_: Company, productId: string, count: number, confirm = true) => {
    const ctx = await actor(company_);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const created = await createSaleOrder(ctx, db, {
        clientId: company_.clientId,
        warehouseId: company_.warehouseId,
        lines: [{ productId, quantity: '1', unitPrice: '5', discount: '0' }],
      });
      if (confirm) await confirmSaleOrder(ctx, db, created.id);
      ids.push(created.id);
    }
    return ids;
  };
  const start = async (company_: Company, orderIds: string[]) =>
    startOrderBatch(
      await actor(company_),
      db,
      { issuePointId: company_.pointId, orderIds, payment: PAYMENT },
      { jobs },
    );
  const view = async (company_: Company, batchId: string) =>
    getBatch(await actor(company_), db, batchId);
  const itemIds = async (company_: Company, batchId: string) =>
    (await view(company_, batchId)).items.map((item) => item.id);
  const run = async (company_: Company, batchId: string) => {
    for (const itemId of await itemIds(company_, batchId))
      await processItem(bulk, { tenantId: company_.tenantId, itemId });
  };
  // SRI answers for every invoice the batch made.
  const answer = async (company_: Company, batchId: string) => {
    for (const item of (await view(company_, batchId)).items)
      if (item.documentId) {
        const ref = { tenantId: company_.tenantId, documentId: item.documentId };
        await sendDocument(sending, ref);
        await checkAuthorization(sending, ref);
      }
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
      .values({ name: 'Owner', email: `bk.${randomUUID()}@example.com`, emailVerified: true })
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
    for (const featureKey of ['SALE_ORDERS', 'INVENTORY', 'BULK_INVOICING'])
      await setOverride(admin, db, {
        realTenantId: org.realTenantId,
        featureKey,
        effect: 'GRANT',
        limitValue: null,
        reason: 'test',
      });
    twin = await company(org.twinTenantId);
    await goLive(await actor({ ...twin, tenantId: org.realTenantId }), db, {
      requireAgreements: false,
    });
    real = await company(org.realTenantId);
  });

  beforeEach(() => {
    clock.set('2026-11-10T15:00:00Z');
    mock = createMockSri({ now: () => clock.now() });
    sending = {
      db,
      sri: createSriClient({ transport: mock.transport }),
      jobs,
      clock,
      logger: testLogger(),
    };
    bulk = {
      db,
      jobs,
      clock,
      logger: testLogger(),
      issue: {
        appEnv: 'local',
        providerRuc: '1712345678001',
        consumerFinalMaxAmount: '50.00',
        keyCipher,
      },
    };
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('queues one item per order, in order, and asks for a whole list', async () => {
    const product = await stocked(twin);
    const ids = await orders(twin, product, 3);
    const batch = await start(twin, [...ids, ids[0]!]);
    expect(batch.totalItems).toBe(3);
    const stack = await view(twin, batch.id);
    expect(stack).toMatchObject({ status: 'PROCESSING', totalItems: 3 });
    expect(stack.counts).toMatchObject({ QUEUED: 3, FAILED: 0 });
    expect(stack.items.map((item) => item.saleOrderId)).toEqual(ids);
    expect(stack.items[0]!.saleOrderNumber).toBeGreaterThan(0);

    expect(await failure(start(twin, [randomUUID()]))).toBe('NOT_FOUND');
    expect(
      await failure(
        startOrderBatch(
          await actor(twin),
          db,
          { issuePointId: randomUUID(), orderIds: ids, payment: PAYMENT },
          { jobs },
        ),
      ),
    ).toBe('NOT_FOUND');
    // Another company's orders are not found, and its batches are not seen.
    expect(await failure(start(real, ids))).toBe('NOT_FOUND');
    expect(await failure(view(real, batch.id))).toBe('NOT_FOUND');
    expect((await listBatches(await actor(twin), db)).rows.map((row) => row.id)).toContain(
      batch.id,
    );
  });

  it('needs the feature and the permissions of invoicing orders', async () => {
    const ctx = await actor(twin);
    const input = { issuePointId: twin.pointId, orderIds: [randomUUID()], payment: PAYMENT };
    expect(
      await failure(
        startOrderBatch({ ...ctx, permissions: ['documents.issue'] }, db, input, { jobs }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await failure(
        startOrderBatch({ ...ctx, permissions: ['sales.manage'] }, db, input, { jobs }),
      ),
    ).toBe('FORBIDDEN');
    expect(await failure(listBatches({ ...ctx, permissions: ['sales.read'] }, db))).toBe(
      'FORBIDDEN',
    );
  });

  it('makes one invoice per item, follows SRI’s answer and completes when all are answered', async () => {
    const product = await stocked(twin);
    const ids = await orders(twin, product, 3);
    const batch = await start(twin, ids);
    await run(twin, batch.id);

    let stack = await view(twin, batch.id);
    expect(stack.counts).toMatchObject({ QUEUED: 0, SENT: 3 });
    expect(stack.items.every((item) => item.view === 'SENT' && item.documentId)).toBe(true);
    expect(stack.items.map((item) => item.attempts)).toEqual([1, 1, 1]);
    // The invoice is the order's own: its quantities are covered and its goods held.
    expect((await getSaleOrder(await actor(twin), db, ids[0]!)).status).toBe('PARTIALLY_INVOICED');
    // Not finished while SRI hasn't answered.
    expect(await completeBatches(bulk)).toBe(0);

    // The job running twice makes no second invoice.
    const first = stack.items[0]!;
    await processItem(bulk, { tenantId: twin.tenantId, itemId: first.id });
    expect((await view(twin, batch.id)).items[0]!.documentId).toBe(first.documentId);

    await answer(twin, batch.id);
    stack = await view(twin, batch.id);
    expect(stack.counts).toMatchObject({ AUTHORIZED: 3, SENT: 0 });
    expect(await completeBatches(bulk)).toBeGreaterThanOrEqual(1);
    expect(await view(twin, batch.id)).toMatchObject({ status: 'COMPLETED' });
    expect((await getSaleOrder(await actor(twin), db, ids[0]!)).status).toBe('INVOICED');
    // FR-BULK-3: the company is told, by a job queued with the completion.
    const told = await db.withSystem('test: batch notice', ({ executeSql }) =>
      executeSql<{ data: { params: { count: string } } }>(
        `SELECT data FROM pgboss.job WHERE name = 'notifications.send'
         AND data->>'type' = 'BATCH_COMPLETED' AND data->>'link' = $1`,
        [`/bulk-invoicing/${batch.id}`],
      ),
    );
    expect(told.rows).toHaveLength(1);
    expect(told.rows[0]!.data.params.count).toBe('3');
  });

  it('finds the invoice a crashed try made instead of making another', async () => {
    const product = await stocked(twin);
    const [orderId] = await orders(twin, product, 1);
    const batch = await start(twin, [orderId!]);
    const [itemId] = await itemIds(twin, batch.id);
    const ctx = await actor(twin);
    // The first try: claimed and invoiced, but the item never saw its commit.
    await db.withTenant({ tenantId: twin.tenantId }, ({ executeSql }) =>
      executeSql(`UPDATE bulk_batch_items SET status = 'CREATING', attempts = 1 WHERE id = $1`, [
        itemId,
      ]),
    );
    const made = await db.withTenant({ tenantId: twin.tenantId }, (tx) =>
      invoiceOrderRemainder(
        ctx,
        tx,
        {
          orderId: orderId!,
          issuePointId: twin.pointId,
          payment: { ...PAYMENT, amount: null, term: null, termUnit: null },
          idempotencyKey: itemId!,
        },
        issueDeps,
      ),
    );
    await processItem(bulk, { tenantId: twin.tenantId, itemId: itemId! });
    const [item] = (await view(twin, batch.id)).items;
    expect(item).toMatchObject({ documentId: made.id, view: 'SENT' });
  });

  it('fails an order that can’t be invoiced alone, with its reason', async () => {
    const product = await stocked(twin);
    const [good] = await orders(twin, product, 1);
    const [draft] = await orders(twin, product, 1, false);
    const batch = await start(twin, [draft!, good!]);
    await run(twin, batch.id);
    const stack = await view(twin, batch.id);
    expect(stack.items[0]).toMatchObject({ view: 'FAILED', errorCode: 'ORDER_NOT_INVOICEABLE' });
    expect(stack.items[1]).toMatchObject({ view: 'SENT' });
    expect(stack.counts).toMatchObject({ FAILED: 1, SENT: 1 });
  });

  it('cuts the batch at the quota, fails the rest item by item, and a retry resumes', async () => {
    const product = await stocked(real);
    const ids = await orders(real, product, 4);
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
      effect: 'LIMIT',
      limitValue: 2,
      reason: 'test',
    });
    const batch = await start(real, ids);
    await run(real, batch.id);
    let stack = await view(real, batch.id);
    // The first two take the quota in order; the others fail alone and the batch goes on.
    const made = 2;
    expect(stack.items.map((item) => item.errorCode)).toEqual([
      null,
      null,
      'QUOTA_EXCEEDED',
      'QUOTA_EXCEEDED',
    ]);
    expect(stack.counts).toMatchObject({ SENT: 2, FAILED: 2 });
    expect(stack.status).toBe('PROCESSING');

    // The made ones are answered and the batch finishes with its failures standing.
    await answer(real, batch.id);
    expect(await completeBatches(bulk)).toBeGreaterThanOrEqual(1);
    expect((await view(real, batch.id)).status).toBe('COMPLETED');

    // More quota, then retry: only the failed items return, and the batch reopens.
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
      effect: 'LIMIT',
      limitValue: null,
      reason: 'test',
    });
    expect(await retryFailedItems(await actor(real), db, batch.id, { jobs })).toBe(4 - made);
    expect(await retryFailedItems(await actor(real), db, batch.id, { jobs })).toBe(0);
    stack = await view(real, batch.id);
    expect(stack).toMatchObject({ status: 'PROCESSING' });
    expect(stack.counts).toMatchObject({ QUEUED: 4 - made, FAILED: 0 });
    await run(real, batch.id);
    await answer(real, batch.id);
    stack = await view(real, batch.id);
    expect(stack.counts).toMatchObject({ AUTHORIZED: 4, QUEUED: 0, FAILED: 0 });
    expect(stack.items.filter((item) => item.attempts === 2)).toHaveLength(4 - made);
    await completeBatches(bulk);
    expect((await view(real, batch.id)).status).toBe('COMPLETED');
  });

  it('counts a rejected invoice as answered, and leaves it to be corrected, not retried', async () => {
    const product = await stocked(twin);
    const ids = await orders(twin, product, 1);
    const batch = await start(twin, ids);
    await run(twin, batch.id);
    const [item] = (await view(twin, batch.id)).items;
    const ref = { tenantId: twin.tenantId, documentId: item!.documentId! };
    await sendDocument(sending, ref);
    mock.queue('authorization', { kind: 'notAuthorized', code: '46', message: 'RUC no existe' });
    await checkAuthorization(sending, ref);
    const stack = await view(twin, batch.id);
    expect(stack.items[0]!.view).toBe('FAILED');
    expect(await retryFailedItems(await actor(twin), db, batch.id, { jobs })).toBe(0);
    expect(await completeBatches(bulk)).toBeGreaterThanOrEqual(1);
  });
  it('lists the orders a batch can take, oldest first, and finds them all for a search', async () => {
    const product = await stocked(twin);
    const [confirmed] = await orders(twin, product, 1);
    const [draft] = await orders(twin, product, 1, false);
    const ctx = await actor(twin);
    const list = await listInvoiceableOrders(ctx, db, {});
    const ids = list.rows.map((row) => row.id);
    expect(ids).toContain(confirmed);
    expect(ids).not.toContain(draft);
    const numbers = list.rows.map((row) => row.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(await invoiceableOrderIds(ctx, db, {}, 10_000)).toContain(confirmed);
    expect(await invoiceableOrderIds(ctx, db, {}, 1)).toHaveLength(1);
    expect(await invoiceableOrderIds(ctx, db, { query: 'nadie con este nombre' }, 10)).toEqual([]);
    // Another company's orders are not in the list.
    expect(
      (await listInvoiceableOrders(await actor(real), db, {})).rows.map((r) => r.id),
    ).not.toContain(confirmed);
  });

  it('shows the platform what waits, company by company, to the super admin only', async () => {
    const product = await stocked(twin);
    const batch = await start(twin, await orders(twin, product, 2));
    const overview = await bulkQueueOverview(await superAdmin(db), db);
    const row = overview.companies.find((company) => company.tenantId === twin.tenantId);
    expect(row).toMatchObject({ isTwin: true });
    expect(row!.waiting).toBeGreaterThanOrEqual(2);
    expect(overview.limits.global).toBeGreaterThan(overview.limits.perCompany);
    expect(
      await failure(bulkQueueOverview({ userId: ownerId, isSuperAdmin: true, clock }, db)),
    ).toBe('FORBIDDEN');
    // The item names its invoice number once it exists.
    await run(twin, batch.id);
    const [item] = (await view(twin, batch.id)).items;
    expect(item!.documentNumber).toMatch(/^001-001-\d{9}$/);
  });
});
