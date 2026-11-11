import { randomUUID } from 'node:crypto';
import {
  BULK_LIMITS,
  companySettings,
  completeBatches,
  confirmSaleOrder,
  createClient,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createNoEmailProvider,
  createProduct,
  createSaleOrder,
  createSriClient,
  getBatch,
  goLive,
  onboardOrganization,
  registerHandlers,
  resolveActor,
  setOverride,
  startOrderBatch,
  systemClock,
  type ActorContext,
  type CreatedOrganization,
  type IssueDeps,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// Milestone 7 gate (FR-BULK-1 to FR-BULK-4, NFR-PERF-3, ADR-026), run locally on the mock SRI:
// `pnpm test:bulk-gate`, on a freshly reset test database. A company's batch of 1,000 orders runs
// through the real queues and handlers with its quota cut at 80 %, while another company issues
// single invoices; their latency must stay within twice what it is when nothing else runs.
// It is skipped in every other run: it takes minutes.
const ITEMS = Number(process.env.BULK_GATE_ITEMS ?? 1000);
const QUOTA = Math.floor(ITEMS * 0.8);
const SINGLES = 20;
// A mock SRI that answers in 50 ms, as a quick SRI would.
const SRI_LATENCY_MS = 50;

const gate = process.env.BULK_GATE ? describe : describe.skip;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values: number[], share: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * share) - 1]!;

gate('Milestone 7 gate: a big batch beside another company’s single invoices', () => {
  const keyCipher = createKeyCipher('c9'.repeat(32));
  let db: Database;
  let jobs: Jobs;
  let issueDeps: IssueDeps;
  let ownerId: string;
  let big: ActorContext;
  let small: ActorContext;
  let bigPoint: string;
  let smallPoint: string;
  let smallClient: string;

  type Company = { org: CreatedOrganization; ruc: string };
  const onboard = async (name: string): Promise<Company> => {
    const ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: name,
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2020-01-01'),
            notAfter: new Date('2040-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher, clock: systemClock },
    );
    return { org, ruc };
  };
  const actorOf = (tenantId: string) =>
    resolveActor(db, { userId: ownerId, tenantId, clock: systemClock });
  const pointOf = async (ctx: ActorContext) =>
    (await companySettings(ctx, db)).branches[0]!.issuePoints[0]!.id;
  const count = (tenantId: string, where: string) =>
    db.withSystem('gate: count batch items', async ({ executeSql }) => {
      const { rows } = await executeSql<{ n: number }>(
        `SELECT count(*)::int AS n FROM bulk_batch_items i
         LEFT JOIN documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
         WHERE i.tenant_id = $1 AND ${where}`,
        [tenantId],
      );
      return rows[0]!.n;
    });
  const until = async (what: string, ready: () => Promise<boolean>, timeoutMs: number) => {
    const limit = Date.now() + timeoutMs;
    while (!(await ready())) {
      if (Date.now() > limit) throw new Error(`Timed out waiting for ${what}`);
      await sleep(500);
    }
  };

  // The company's own single invoices, one a second, each timed from creation to authorization.
  const singles = async (): Promise<number[]> => {
    const created: { id: string; started: number }[] = [];
    for (let i = 0; i < SINGLES; i++) {
      const document = await createInvoice(
        small,
        db,
        {
          issuePointId: smallPoint,
          clientId: smallClient,
          lines: [{ code: 'A', name: 'Café', quantity: '1', unitPrice: '10', ivaRateCode: '4' }],
          payments: [{ method: '01', amount: '11.50' }],
        },
        issueDeps,
      );
      created.push({ id: document.id, started: performance.now() });
      await sleep(1000);
    }
    const latencies = new Map<string, number>();
    await until(
      'the single invoices to be authorized',
      async () => {
        const { rows } = await db.withTenant({ tenantId: small.tenantId }, ({ executeSql }) =>
          executeSql<{ id: string }>(
            `SELECT id FROM documents WHERE status = 'AUTHORIZED' AND id = ANY($1)`,
            [created.map((entry) => entry.id)],
          ),
        );
        const seen = performance.now();
        for (const row of rows)
          if (!latencies.has(row.id))
            latencies.set(row.id, seen - created.find((entry) => entry.id === row.id)!.started);
        return latencies.size === created.length;
      },
      5 * 60_000,
    );
    return [...latencies.values()];
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'worker', logger: testLogger() });
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
      .values({ name: 'Owner', email: `gate.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;

    const bigCompany = await onboard('Gran Volumen S.A.');
    const smallCompany = await onboard('Pocos Comprobantes S.A.');
    const admin = await superAdmin(db);
    for (const featureKey of ['SALE_ORDERS', 'INVENTORY', 'BULK_INVOICING'])
      await setOverride(admin, db, {
        realTenantId: bigCompany.org.realTenantId,
        featureKey,
        effect: 'GRANT',
        limitValue: null,
        reason: 'gate',
      });
    // The cut: a company in production mode has a quota (the twin never does).
    await setOverride(admin, db, {
      realTenantId: bigCompany.org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
      effect: 'LIMIT',
      limitValue: QUOTA,
      reason: 'gate',
    });
    await goLive(await actorOf(bigCompany.org.realTenantId), db, { requireAgreements: false });
    big = await actorOf(bigCompany.org.realTenantId);
    small = await actorOf(smallCompany.org.twinTenantId);
    bigPoint = await pointOf(big);
    smallPoint = await pointOf(small);
    smallClient = (
      await createClient(small, db, {
        idType: '05',
        identification: '1710034065',
        name: 'María López',
        emails: ['maria@example.com'],
      })
    ).id;

    // The worker, in this process: the real handlers on the real queues, over a mock SRI.
    const mock = createMockSri();
    const delayed = Object.assign(
      async (request: Parameters<typeof mock.transport>[0]) => {
        await sleep(SRI_LATENCY_MS);
        return mock.transport(request);
      },
      { source: 'mock' as const },
    );
    await registerHandlers(jobs, {
      logger: testLogger(),
      emailProvider: createNoEmailProvider(),
      identityDb: db.identity,
      db,
      sri: createSriClient({ transport: delayed }),
      keyCipher,
      clock: systemClock,
      issue: {
        appEnv: 'local',
        providerRuc: '1712345678001',
        consumerFinalMaxAmount: '50.00',
      },
      billing: { appUrl: 'http://localhost:3000' },
      payphone: null,
    });
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it(
    `makes ${ITEMS} invoices, cuts the batch at the quota of ${QUOTA}, and keeps another company's latency within 2×`,
    async () => {
      // Orders for the batch: a service, so no stock gets in the way of the timing.
      const { id: productId } = await createProduct(big, db, {
        code: 'GATE-SVC',
        name: 'Servicio del lote',
        kind: 'SERVICE',
        price: '10',
        cost: null,
        ivaRateCode: '4',
        tracksStock: false,
      });
      const [warehouse] = await db.withTenant({ tenantId: big.tenantId }, ({ db: tx }) =>
        tx.select().from(schema.warehouses),
      );
      const clientId = (
        await createClient(big, db, {
          idType: '05',
          identification: '1710034065',
          name: 'María López',
          emails: ['maria@example.com'],
        })
      ).id;
      const orderIds: string[] = [];
      for (let i = 0; i < ITEMS; i++) {
        const order = await createSaleOrder(big, db, {
          clientId,
          warehouseId: warehouse!.id,
          lines: [{ productId, quantity: '1', unitPrice: '10', discount: '0' }],
        });
        await confirmSaleOrder(big, db, order.id);
        orderIds.push(order.id);
      }

      // Alone: how long a single invoice takes through the queues.
      const alone = await singles();

      // The batch, and the same single invoices beside it once it is under way.
      const startedAt = performance.now();
      const batch = await startOrderBatch(
        big,
        db,
        { issuePointId: bigPoint, orderIds, payment: { method: '01' } },
        { jobs },
      );
      await until(
        'the batch to fill its room',
        async () =>
          (await count(big.tenantId, `i.status = 'CREATED'`)) >=
          Math.min(BULK_LIMITS.perCompany, ITEMS / 4),
        120_000,
      );
      const beside = await singles();

      // Until every item has been made or failed and every invoice has its answer.
      await until(
        'the batch to finish',
        async () => {
          await completeBatches({ db, jobs, clock: systemClock, logger: testLogger() });
          return (await getBatch(big, db, batch.id, { limit: 1 })).status === 'COMPLETED';
        },
        30 * 60_000,
      );
      const seconds = (performance.now() - startedAt) / 1000;

      const done = await getBatch(big, db, batch.id, { limit: 1 });
      const failures = await count(big.tenantId, `i.error_code = 'QUOTA_EXCEEDED'`);
      const p95 = { alone: percentile(alone, 0.95), beside: percentile(beside, 0.95) };
      const p50 = { alone: percentile(alone, 0.5), beside: percentile(beside, 0.5) };
      const results = {
        items: ITEMS,
        quota: QUOTA,
        authorized: done.counts.AUTHORIZED,
        quotaFailures: failures,
        batchSeconds: Math.round(seconds),
        invoicesPerSecond: Number((done.counts.AUTHORIZED / seconds).toFixed(2)),
        p50AloneMs: Math.round(p50.alone),
        p50BesideMs: Math.round(p50.beside),
        p95AloneMs: Math.round(p95.alone),
        p95BesideMs: Math.round(p95.beside),
        p95Ratio: Number((p95.beside / p95.alone).toFixed(2)),
      };
      process.stdout.write(`\nBULK GATE RESULTS ${JSON.stringify(results, null, 2)}\n`);

      // The quota cut the batch item by item, and the rest went through.
      expect(done.counts).toMatchObject({ AUTHORIZED: QUOTA, FAILED: ITEMS - QUOTA, QUEUED: 0 });
      expect(failures).toBe(ITEMS - QUOTA);
      // NFR-PERF-3: the other company barely noticed.
      expect(p95.beside).toBeLessThanOrEqual(2 * p95.alone);
    },
    45 * 60_000,
  );
});
