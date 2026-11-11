import { randomUUID } from 'node:crypto';
import {
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  resolveActor,
  runReport,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument } from './helpers';

// FR-REP-2: the sales, documents and tax reports, read from seeded documents. Authorized invoices
// count, authorized credit notes take away, and a voided or unfinished document is no sale.
describe('reports', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let ownerId: string;
  let viewerId: string;
  let accountantId: string;
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: reports setup', ({ executeSql }) => executeSql(text, values));
  const as = (userId: string) => resolveActor(db, { userId, tenantId: org.realTenantId, clock });
  const moveTo = async (id: string, path: string[]) => {
    for (const status of path)
      await sql('UPDATE documents SET status = $1 WHERE id = $2', [status, id]);
  };
  const AUTHORIZED = ['PENDING_SEND', 'RECEIVED', 'AUTHORIZED'];
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const range = { from: '2026-11-01', to: '2026-11-10' };

  beforeAll(async () => {
    db = appDatabase();
    const users = await db.identity
      .insert(schema.users)
      .values(
        ['Owner', 'Viewer', 'Accountant'].map((name) => ({
          name,
          email: `rp.${randomUUID()}@example.com`,
          emailVerified: true,
        })),
      )
      .returning({ id: schema.users.id });
    [ownerId, viewerId, accountantId] = users.map((user) => user.id) as [string, string, string];
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Zeta S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2030-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('e5'.repeat(32)), clock },
    );
    await sql(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'VIEWER'), ($1, $3, 'ACCOUNTANT')`,
      [org.realTenantId, viewerId, accountantId],
    );

    const tenant = org.realTenantId;
    const a = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-10',
      buyerIdentification: '1710034065',
    });
    const b = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-03',
      buyerIdentification: '1710034065',
    });
    const c = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-05',
      buyerIdentification: '0992339411001',
      amounts: { base: '20.00', iva: '3.00', total: '23.00' },
    });
    const credit = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-10',
      buyerIdentification: '1710034065',
      documentType: '04',
      relatedDocumentId: a.id,
      amounts: { base: '2.00', iva: '0.30', total: '2.30' },
    });
    const voided = await insertTestDocument(db, tenant, { issueDate: '2026-11-10' });
    await insertTestDocument(db, tenant, { issueDate: '2026-11-09' });
    for (const document of [a, b, c, credit]) await moveTo(document.id, AUTHORIZED);
    await moveTo(voided.id, [...AUTHORIZED, 'VOIDED']);
  });

  afterAll(() => db.close());

  it('adds up sales by day, net of credit notes', async () => {
    const report = await runReport(await as(ownerId), db, { report: 'sales', ...range });
    expect(report.columns.map((column) => column.key)).toEqual([
      'date',
      'invoices',
      'base',
      'iva',
      'total',
    ]);
    expect(report.rows).toEqual([
      ['2026-11-03', '1', '10.00', '1.50', '11.50'],
      ['2026-11-05', '1', '20.00', '3.00', '23.00'],
      ['2026-11-10', '1', '8.00', '1.20', '9.20'],
    ]);
    expect(report.totals).toEqual(['', '3', '38.00', '5.70', '43.70']);
  });

  it('groups sales by client and by product', async () => {
    const byClient = await runReport(await as(ownerId), db, {
      report: 'sales',
      groupBy: 'client',
      ...range,
    });
    expect(byClient.rows.map((row) => [row[0], row[2], row[5]])).toEqual([
      ['0992339411001', '1', '23.00'],
      ['1710034065', '2', '20.70'],
    ]);
    const byProduct = await runReport(await as(ownerId), db, {
      report: 'sales',
      groupBy: 'product',
      ...range,
    });
    expect(byProduct.rows).toEqual([['P-1', 'Producto', '2.000000', '38.00', '5.70', '43.70']]);
  });

  it('summarizes IVA by rate for the declaration', async () => {
    const taxes = await runReport(await as(ownerId), db, { report: 'taxes', ...range });
    expect(taxes.rows).toEqual([['15.00', '38.00', '5.70', '43.70']]);
    expect(taxes.totals).toEqual(['', '38.00', '5.70', '43.70']);
  });

  it('lists every document of the range, whatever its status', async () => {
    const issued = await runReport(await as(ownerId), db, { report: 'documents', ...range });
    expect(issued.rows).toHaveLength(6);
    expect(issued.totals).toBeNull();
    expect(issued.rows.map((row) => row[5])).toEqual(
      expect.arrayContaining(['AUTHORIZED', 'VOIDED', 'SIGNED']),
    );
    expect(issued.rows[0]![0]).toBe('2026-11-03');
    expect(issued.rows[0]![2]).toMatch(/^001-001-\d{9}$/);

    const cut = await runReport(
      await as(ownerId),
      db,
      { report: 'documents', ...range },
      { limit: 3 },
    );
    expect(cut.rows).toHaveLength(3);
    expect(cut.truncated).toBe(true);
  });

  it('keeps to its ranges, and to who may read and who may download', async () => {
    const owner = await as(ownerId);
    expect(
      await failure(
        runReport(owner, db, { report: 'sales', from: '2026-11-10', to: '2026-11-01' }),
      ),
    ).toBe('REPORT_RANGE_INVALID');
    expect(
      await failure(
        runReport(owner, db, { report: 'sales', from: '2025-01-01', to: '2026-11-10' }),
      ),
    ).toBe('REPORT_RANGE_TOO_LONG');
    // Left out, the range is the month so far.
    const sofar = await runReport(owner, db, { report: 'sales' });
    expect([sofar.from, sofar.to]).toEqual(['2026-11-01', '2026-11-10']);

    // A viewer reads reports but takes no file; an accountant does both.
    const viewer = await as(viewerId);
    await expect(runReport(viewer, db, { report: 'taxes', ...range })).resolves.toBeTruthy();
    expect(
      await failure(runReport(viewer, db, { report: 'taxes', ...range }, { export: true })),
    ).toBe('FORBIDDEN');
    const accountant = await as(accountantId);
    await expect(
      runReport(accountant, db, { report: 'taxes', ...range }, { export: true }),
    ).resolves.toBeTruthy();
  });
});
