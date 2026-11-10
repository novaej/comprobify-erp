import { randomUUID } from 'node:crypto';
import {
  checkAuthorization,
  companySettings,
  confirmSaleOrder,
  createClient,
  createJobs,
  createKeyCipher,
  createMockSri,
  createProduct,
  createSaleOrder,
  createSriClient,
  feedBatches,
  fixedClock,
  getBatch,
  goLive,
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
  type BulkLimits,
  type CreatedOrganization,
  type Jobs,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-BULK-4, NFR-PERF-3 (ADR-026): the feeder hands waiting items to the worker company by
// company, within a room per company and overall, so a big batch can't crowd out a small one.
describe('feeding batches', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('c8'.repeat(32));
  const limits: BulkLimits = { perCompany: 3, global: 4, stallMinutes: 15, feedDelaySeconds: 5 };
  let db: Database;
  let jobs: Jobs;
  let org: CreatedOrganization;
  let ownerId: string;
  // The twin and the real company share a RUC and numbers, which one SRI would refuse as taken.
  const sri = new Map<string, SendingDeps>();
  let bulk: BulkDeps;

  type Company = { tenantId: string; pointId: string; warehouseId: string; clientId: string };
  let big: Company;
  let small: Company;

  const actor = (company: Company): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: company.tenantId, clock });
  const only = () => [big.tenantId, small.tenantId];
  const feed = () => feedBatches(bulk, limits, only());

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
  // A batch of `count` confirmed one-unit orders.
  const batchOf = async (company_: Company, count: number, confirm = true) => {
    const ctx = await actor(company_);
    const { id: productId } = await createProduct(ctx, db, {
      code: `P-${randomUUID().slice(0, 8)}`,
      name: 'Café molido',
      kind: 'GOOD',
      price: '5',
      cost: '2',
      ivaRateCode: '4',
      tracksStock: true,
    });
    await setOpeningBalance(ctx, db, {
      productId,
      warehouseId: company_.warehouseId,
      quantity: '50',
      unitCost: '2',
    });
    const orderIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const order = await createSaleOrder(ctx, db, {
        clientId: company_.clientId,
        warehouseId: company_.warehouseId,
        lines: [{ productId, quantity: '1', unitPrice: '5', discount: '0' }],
      });
      if (confirm) await confirmSaleOrder(ctx, db, order.id);
      orderIds.push(order.id);
    }
    return startOrderBatch(
      ctx,
      db,
      { issuePointId: company_.pointId, orderIds, payment: { method: '01' } },
      { jobs },
    );
  };
  const sql = <Row extends object>(text: string, values: unknown[] = []) =>
    db.withSystem('test: read bulk items', async ({ executeSql }) => {
      const { rows } = await executeSql<Row>(text, values);
      return rows;
    });
  const dispatched = async (batchId: string) =>
    (
      await sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM bulk_batch_items
         WHERE batch_id = $1 AND dispatched_at IS NOT NULL`,
        [batchId],
      )
    )[0]!.n;
  const queuedJobs = async (batchId: string) =>
    (
      await sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM pgboss.job j
         WHERE j.name = 'bulk.item'
           AND j.data->>'itemId' IN (SELECT id::text FROM bulk_batch_items WHERE batch_id = $1)`,
        [batchId],
      )
    )[0]!.n;
  // What the worker would do with the jobs it was handed.
  const work = async (company_: Company, batchId: string) => {
    const rows = await sql<{ id: string }>(
      `SELECT id FROM bulk_batch_items
       WHERE batch_id = $1 AND dispatched_at IS NOT NULL AND status IN ('QUEUED', 'CREATING')`,
      [batchId],
    );
    for (const { id } of rows) await processItem(bulk, { tenantId: company_.tenantId, itemId: id });
  };
  const sendingFor = (company_: Company): SendingDeps => {
    if (!sri.has(company_.tenantId))
      sri.set(company_.tenantId, {
        db,
        sri: createSriClient({ transport: createMockSri({ now: () => clock.now() }).transport }),
        jobs,
        clock,
        logger: testLogger(),
      });
    return sri.get(company_.tenantId)!;
  };
  const answer = async (company_: Company, batchId: string) => {
    for (const item of (await getBatch(await actor(company_), db, batchId)).items)
      if (item.documentId) {
        const ref = { tenantId: company_.tenantId, documentId: item.documentId };
        const sending = sendingFor(company_);
        await sendDocument(sending, ref);
        await checkAuthorization(sending, ref);
      }
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `bf.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Omega S.A.',
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
    // The plan's quota is not what this test is about.
    await setOverride(admin, db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
      effect: 'LIMIT',
      limitValue: null,
      reason: 'test',
    });
    small = await company(org.twinTenantId);
    await goLive(await actor({ ...small, tenantId: org.realTenantId }), db, {
      requireAgreements: false,
    });
    big = await company(org.realTenantId);
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

  it('serves a small company beside a big one, within the room, and gives room back as SRI answers', async () => {
    const large = await batchOf(big, 6);
    const little = await batchOf(small, 2);

    // Turn by turn: the big batch takes what is left after the small one has all it asked for.
    expect(await feed()).toMatchObject({ dispatched: 4, waiting: 4 });
    expect(await dispatched(large.id)).toBe(2);
    expect(await dispatched(little.id)).toBe(2);
    // One job per dispatched item, and none for the rest.
    expect(await queuedJobs(large.id)).toBe(2);
    expect(await queuedJobs(little.id)).toBe(2);

    // Full: asking again gives nothing, and queues nothing twice.
    expect(await feed()).toMatchObject({ dispatched: 0, waiting: 4 });
    expect(await queuedJobs(large.id)).toBe(2);

    // The invoices are made, but SRI hasn't answered: they still hold their room.
    await work(big, large.id);
    await work(small, little.id);
    expect(await feed()).toMatchObject({ dispatched: 0 });

    // The small company's are answered: the big one gets the room that frees, up to its own.
    await answer(small, little.id);
    expect(await feed()).toMatchObject({ dispatched: 1 });
    expect(await dispatched(large.id)).toBe(3);

    // Everything answered: the rest of the big batch follows, a company's room at a time.
    await work(big, large.id);
    await answer(big, large.id);
    expect(await feed()).toMatchObject({ dispatched: 3, waiting: 0 });
    expect(await dispatched(large.id)).toBe(6);
    await work(big, large.id);
    await answer(big, large.id);
    const stack = await getBatch(await actor(big), db, large.id);
    expect(stack.counts).toMatchObject({ AUTHORIZED: 6, QUEUED: 0 });
  });

  it('queues again an item whose job was lost, without taking more room', async () => {
    const batch = await batchOf(small, 1);
    expect(await feed()).toMatchObject({ dispatched: 1 });
    expect(await queuedJobs(batch.id)).toBe(1);
    // Nothing happens to it for longer than the stall time.
    clock.set('2026-11-10T15:20:00Z');
    try {
      expect(await feed()).toMatchObject({ dispatched: 0 });
      expect(await queuedJobs(batch.id)).toBe(2);
    } finally {
      clock.set('2026-11-10T15:00:00Z');
    }
  });

  it('feeds a retried item again', async () => {
    const batch = await batchOf(small, 1, false);
    await feed();
    await work(small, batch.id);
    const [item] = (await getBatch(await actor(small), db, batch.id)).items;
    expect(item).toMatchObject({ view: 'FAILED', errorCode: 'ORDER_NOT_INVOICEABLE' });
    expect(await retryFailedItems(await actor(small), db, batch.id, { jobs })).toBe(1);
    expect(await dispatched(batch.id)).toBe(0);
    expect(await feed()).toMatchObject({ dispatched: 1 });
    expect(await queuedJobs(batch.id)).toBe(2);
  });
});
