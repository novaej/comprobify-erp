import { randomUUID } from 'node:crypto';
import {
  companySettings,
  createClient,
  createJobs,
  createKeyCipher,
  createProduct,
  fixedClock,
  getBatch,
  onboardOrganization,
  processItem,
  resolveActor,
  setOverride,
  startCsvBatch,
  type ActorContext,
  type BulkDeps,
  type CreatedOrganization,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-BULK-1 (ADR-026): a CSV file starts a batch of invoices, on a plan with Bulk invoicing and
// no Sales module. Rows with one reference are the lines of one invoice, and the whole file is
// checked before anything is queued.
describe('bulk invoicing from a CSV', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('d8'.repeat(32));
  let db: Database;
  let jobs: Jobs;
  let bulk: BulkDeps;
  let org: CreatedOrganization;
  let ownerId: string;
  let viewerId: string;
  let pointId: string;
  const payment = { method: '01' as const };
  const deps = () => ({ jobs, consumerFinalMaxAmount: '50.00' });
  const actor = (userId = ownerId): Promise<ActorContext> =>
    resolveActor(db, { userId, tenantId: org.twinTenantId, clock });
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: csv batch setup', ({ executeSql }) => executeSql(text, values));
  const start = async (text: string, userId = ownerId) =>
    startCsvBatch(await actor(userId), db, { text, issuePointId: pointId, payment }, deps());
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const batchCount = async () =>
    Number(
      (
        await sql(`SELECT count(*)::int AS n FROM bulk_batches WHERE tenant_id = $1`, [
          org.twinTenantId,
        ])
      ).rows[0]!.n,
    );

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const users = await db.identity
      .insert(schema.users)
      .values(
        ['Owner', 'Viewer'].map((name) => ({
          name,
          email: `bc.${randomUUID()}@example.com`,
          emailVerified: true,
        })),
      )
      .returning({ id: schema.users.id });
    ownerId = users[0]!.id;
    viewerId = users[1]!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Omicron S.A.',
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
    // Bulk invoicing alone: no Sales module, which an order batch needs and a CSV does not.
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'BULK_INVOICING',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    await sql(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'VIEWER'), ($3, $2, 'VIEWER')`,
      [org.realTenantId, viewerId, org.twinTenantId],
    );
    const owner = await actor();
    pointId = (await companySettings(owner, db)).branches[0]!.issuePoints[0]!.id;
    await createClient(owner, db, {
      idType: '05',
      identification: '1710034065',
      name: 'María López',
      emails: ['maria@example.com'],
    });
    for (const [code, name, price] of [
      ['CAF-1', 'Café molido', '5'],
      ['TE-1', 'Té verde', '10'],
    ] as const)
      await createProduct(owner, db, {
        code,
        name,
        kind: 'GOOD',
        price,
        ivaRateCode: '4',
        tracksStock: false,
      });
    const inactive = await createProduct(owner, db, {
      code: 'OLD-1',
      name: 'Descontinuado',
      kind: 'GOOD',
      price: '1',
      ivaRateCode: '4',
      tracksStock: false,
    });
    await sql(`UPDATE products SET active = false WHERE id = $1`, [inactive.id]);
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

  it('turns rows into invoices, many products to one, and makes them like any invoice', async () => {
    const file = [
      'referencia;cliente;producto;cantidad;precio;descuento',
      'A-1;1710034065;CAF-1;2;;',
      'A-1;1710034065;TE-1;1;;',
      'B-1;;CAF-1;3;4,50;',
      'C-1;1710034065;TE-1;2;;5',
    ].join('\r\n');
    const made = await start(file);
    expect(made.problems).toEqual([]);
    const batch = made.batch!;
    expect(batch.totalItems).toBe(3);
    const stack = await getBatch(await actor(), db, batch.id);
    expect(stack).toMatchObject({ source: 'CSV', status: 'PROCESSING', totalItems: 3 });
    expect(stack.counts).toMatchObject({ QUEUED: 3 });
    // In the order the file first names them.
    expect(stack.items.map((item) => item.reference)).toEqual(['A-1', 'B-1', 'C-1']);
    expect(stack.items.every((item) => item.saleOrderId === null)).toBe(true);

    for (const item of stack.items)
      await processItem(bulk, { tenantId: org.twinTenantId, itemId: item.id });
    // Doing it again, as a retried job would, makes nothing new.
    await processItem(bulk, { tenantId: org.twinTenantId, itemId: stack.items[0]!.id });

    const done = await getBatch(await actor(), db, batch.id);
    expect(done.items.map((item) => item.view)).toEqual(['SENT', 'SENT', 'SENT']);
    const documents = await sql(
      `SELECT d.buyer_identification AS buyer, d.subtotal, d.total, d.status,
              (SELECT count(*)::int FROM document_lines l WHERE l.document_id = d.id) AS lines,
              (SELECT method FROM document_payments p WHERE p.document_id = d.id) AS method
       FROM documents d JOIN bulk_batch_items i ON i.document_id = d.id
       WHERE i.batch_id = $1 ORDER BY i.position`,
      [batch.id],
    );
    expect(documents.rows).toEqual([
      // 2 × 5 and 1 × 10 on one invoice, with 15 % IVA.
      {
        buyer: '1710034065',
        subtotal: '20.00',
        total: '23.00',
        status: 'SIGNED',
        lines: 2,
        method: '01',
      },
      // Consumidor final, at the file's price instead of the catalogue's.
      {
        buyer: '9999999999999',
        subtotal: '13.50',
        total: '15.53',
        status: 'SIGNED',
        lines: 1,
        method: '01',
      },
      // 2 × 10 less a discount of 5.
      {
        buyer: '1710034065',
        subtotal: '15.00',
        total: '17.25',
        status: 'SIGNED',
        lines: 1,
        method: '01',
      },
    ]);
  });

  it('names every wrong row and starts nothing', async () => {
    const before = await batchCount();
    const file = [
      'reference,client,product,quantity,unit_price,discount',
      'OK-1,1710034065,CAF-1,1,,',
      ',1710034065,CAF-1,1,,',
      'X-1,1710034065,NO-SUCH,1,,',
      'X-2,9999999,CAF-1,1,,',
      'X-3,1710034065,OLD-1,1,,',
      'X-4,1710034065,CAF-1,0,,',
      'X-5,1710034065,CAF-1,1,abc,',
      'X-6,1710034065,CAF-1,1,5,50',
      'M-1,1710034065,CAF-1,1,,',
      'M-1,,CAF-1,1,,',
      'F-1,,TE-1,100,,',
    ].join('\n');
    const result = await start(file);
    expect(result.batch).toBeNull();
    expect(result.problems).toEqual([
      { line: 3, code: 'REFERENCE_REQUIRED', field: 'reference' },
      { line: 4, code: 'PRODUCT_NOT_FOUND', field: 'product' },
      { line: 5, code: 'CLIENT_NOT_FOUND', field: 'client' },
      { line: 6, code: 'PRODUCT_INACTIVE', field: 'product' },
      { line: 7, code: 'INVALID_FIELD', field: 'quantity' },
      { line: 8, code: 'INVALID_FIELD', field: 'unit_price' },
      { line: 9, code: 'DISCOUNT_TOO_LARGE', field: 'discount' },
      { line: 11, code: 'CLIENT_MISMATCH', field: 'client' },
    ]);
    expect(await batchCount()).toBe(before);

    // Consumidor final over the limit is only known from the whole invoice.
    const limit = await start(
      'reference,client,product,quantity\nF-1,,TE-1,2\nF-1,,CAF-1,2\nF-2,,TE-1,1\nF-3,,TE-1,100',
    );
    expect(limit.problems).toEqual([{ line: 5, code: 'CONSUMER_FINAL_LIMIT', field: 'client' }]);
    expect(await batchCount()).toBe(before);
  });

  it('refuses a file without its columns, an empty one, and who may not issue', async () => {
    expect(await failure(start('reference,client\nA,B'))).toBe('IMPORT_COLUMNS');
    expect(await failure(start(''))).toBe('IMPORT_EMPTY');
    expect(await failure(start('reference,product,quantity'))).toBe('IMPORT_EMPTY');
    expect(await failure(start('reference,product,quantity\nA,CAF-1,1', viewerId))).toBe(
      'FORBIDDEN',
    );
    expect(
      await failure(
        startCsvBatch(
          await actor(),
          db,
          { text: 'reference,product,quantity\nA,CAF-1,1', issuePointId: randomUUID(), payment },
          deps(),
        ),
      ),
    ).toBe('NOT_FOUND');
  });
});
