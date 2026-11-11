import { randomUUID } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';
import {
  accountantExport,
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  resolveActor,
  runReport,
  setOverride,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument, superAdmin } from './helpers';

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

  // The ZIP read back by its central directory: name to text.
  const unzip = (zip: Buffer) => {
    const end = zip.length - 22;
    const count = zip.readUInt16LE(end + 10);
    let at = zip.readUInt32LE(end + 16);
    const files = new Map<string, string>();
    for (let i = 0; i < count; i++) {
      const method = zip.readUInt16LE(at + 10);
      const size = zip.readUInt32LE(at + 20);
      const nameLength = zip.readUInt16LE(at + 28);
      const local = zip.readUInt32LE(at + 42);
      const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const body = zip.subarray(start, start + size);
      const data = method === 8 ? inflateRawSync(body) : body;
      expect(crc32(data)).toBe(zip.readUInt32LE(at + 16));
      files.set(name, data.toString('utf8'));
      at += 46 + nameLength;
    }
    return files;
  };

  it('puts a month’s authorizations in a ZIP, the voided ones apart', async () => {
    // The SRI's answer is kept on the document; seeded here for the authorized and voided ones.
    await sql(
      `UPDATE documents SET authorization_xml = '<autorizacion>' || access_key || '</autorizacion>'
       WHERE tenant_id = $1 AND status IN ('AUTHORIZED', 'VOIDED')`,
      [org.realTenantId],
    );
    const owner = await as(ownerId);
    const made = await accountantExport(owner, db, '2026-11');
    expect(made).toMatchObject({ filename: 'comprobantes-2026-11.zip', authorized: 4, voided: 1 });
    const files = unzip(made.zip);
    expect(files.size).toBe(5);
    const names = [...files.keys()];
    expect(names.filter((name) => name.startsWith('autorizados/01-001-001-'))).toHaveLength(3);
    expect(names.filter((name) => name.startsWith('autorizados/04-001-001-'))).toHaveLength(1);
    expect(names.filter((name) => name.startsWith('anulados/'))).toHaveLength(1);
    expect([...files.values()].every((xml) => xml.startsWith('<autorizacion>'))).toBe(true);

    // Another month is empty, a bad month is refused, and only who may export can ask.
    expect(await failure(accountantExport(owner, db, '2026-09'))).toBe('EXPORT_EMPTY');
    await expect(accountantExport(owner, db, '2026-13')).rejects.toThrow();
    expect(await failure(accountantExport(await as(viewerId), db, '2026-11'))).toBe('FORBIDDEN');
    await expect(accountantExport(await as(accountantId), db, '2026-11')).resolves.toBeTruthy();
  });

  it('reads stock movements and purchases by provider, once the plan has the modules', async () => {
    const owner = await as(ownerId);
    expect(await failure(runReport(owner, db, { report: 'movements', ...range }))).toBe(
      'FEATURE_NOT_ENABLED',
    );
    const operator = { ...(await superAdmin(db)), clock };
    for (const featureKey of ['INVENTORY', 'PURCHASE_ORDERS'])
      await setOverride(operator, db, {
        realTenantId: org.realTenantId,
        featureKey,
        effect: 'GRANT',
        limitValue: null,
        reason: 'test',
      });
    // Entitlements are read with the actor, so take a new one.
    const granted = await as(ownerId);
    const tenant = org.realTenantId;
    const [warehouse] = (
      await sql(`SELECT id FROM warehouses WHERE tenant_id = $1 LIMIT 1`, [tenant])
    ).rows as { id: string }[];
    const product = (
      await sql(
        `INSERT INTO products (tenant_id, code, name, kind, price, iva_rate_code, tracks_stock)
         VALUES ($1, 'M-1', 'Café', 'GOOD', '5', '4', true) RETURNING id`,
        [tenant],
      )
    ).rows[0] as { id: string };
    await sql(
      `INSERT INTO stock_levels (tenant_id, product_id, warehouse_id, on_hand) VALUES ($1, $2, $3, 8)`,
      [tenant, product.id, warehouse!.id],
    );
    // 23:30 in Quito on the 9th is already the 10th in UTC: the report keeps Ecuador's day.
    await sql(
      `INSERT INTO stock_movements (tenant_id, product_id, warehouse_id, type, quantity, unit_cost, value, reason, created_at)
       VALUES ($1, $2, $3, 'PURCHASE_RECEIPT', 10, 2, 20, 'Compra', '2026-11-10T04:30:00Z'),
              ($1, $2, $3, 'SALE', -2, 2, -4, NULL, '2026-11-10T14:00:00Z'),
              ($1, $2, $3, 'ADJUSTMENT_IN', 1, 2, 2, 'Fuera de rango', '2026-10-20T14:00:00Z')`,
      [tenant, product.id, warehouse!.id],
    );
    const movements = await runReport(granted, db, { report: 'movements', ...range });
    expect(movements.rows).toEqual([
      [
        '2026-11-09',
        'PURCHASE_RECEIPT',
        'M-1',
        'Café',
        expect.any(String),
        '10.000000',
        '2.000000',
        '20.000000',
        'Compra',
      ],
      [
        '2026-11-10',
        'SALE',
        'M-1',
        'Café',
        expect.any(String),
        '-2.000000',
        '2.000000',
        '-4.000000',
        '',
      ],
    ]);
    expect(movements.totals).toBeNull();

    const provider = (
      await sql(
        `INSERT INTO providers (tenant_id, id_type, identification, name, emails)
         VALUES ($1, '04', '1790012345001', 'Distribuidora Andes', '{}') RETURNING id`,
        [tenant],
      )
    ).rows[0] as { id: string };
    const order = (
      status: string,
      date: string,
      number: number,
      base: string,
      iva: string,
      total: string,
    ) =>
      sql(
        `INSERT INTO purchase_orders (tenant_id, number, provider_id, warehouse_id, status, order_date, subtotal, iva, total, cancelled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $5 = 'CANCELLED' THEN now() END)`,
        [tenant, number, provider.id, warehouse!.id, status, date, base, iva, total],
      );
    await order('SENT', '2026-11-02', 1, '100.00', '15.00', '115.00');
    await order('RECEIVED', '2026-11-08', 2, '40.00', '6.00', '46.00');
    await order('DRAFT', '2026-11-08', 3, '999.00', '0.00', '999.00');
    await order('CANCELLED', '2026-11-08', 4, '999.00', '0.00', '999.00');
    await order('SENT', '2026-10-30', 5, '999.00', '0.00', '999.00');
    const purchases = await runReport(granted, db, { report: 'purchases', ...range });
    expect(purchases.rows).toEqual([
      ['1790012345001', 'Distribuidora Andes', '2', '140.00', '21.00', '161.00'],
    ]);
    expect(purchases.totals).toEqual(['', '', '2', '140.00', '21.00', '161.00']);
  });
});
