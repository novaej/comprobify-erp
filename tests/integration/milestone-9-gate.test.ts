import { randomUUID } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';
import {
  accountantExport,
  agingReport,
  createKeyCipher,
  dashboard,
  DEFAULT_COPY,
  draftEmailTemplate,
  draftFromVersion,
  fixedClock,
  getEmailTemplate,
  loadCopy,
  onboardOrganization,
  previewEmailTemplate,
  publishEmailTemplate,
  resolveActor,
  runReport,
  sendEmailHandler,
  setOverride,
  type ActorContext,
  type CreatedOrganization,
  type EmailMessage,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument, superAdmin } from './helpers';

// Milestone 9 gate (PRD section 15): reports match seeded data, and templates are editable. One
// company with a month of known documents, stock movements, purchases and receivables; every
// figure below is worked out by hand from them, then the reports are held to each other.
//
// November 2026, the 10th is "today". Invoices (base / IVA 15 % / total):
//   A  10 Nov  client X  100.00  15.00  115.00   authorized
//   B  10 Nov  client Y  200.00  30.00  230.00   authorized
//   C   3 Nov  client X   50.00   7.50   57.50   authorized
//   N  10 Nov  client X   20.00   3.00   23.00   authorized credit note, of A
//   V  10 Nov            1000.00 150.00 1150.00  authorized, then voided
//   O  28 Oct  client Y   80.00  12.00   92.00   authorized, last month
//   R   9 Nov                                    returned by SRI
//   W   9 Nov                                    received, waiting for SRI
describe('Milestone 9 gate: reports match seeded data, templates are editable', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let org: CreatedOrganization;
  let ownerId: string;
  let accountantId: string;
  let viewerId: string;
  const doc: Record<string, { id: string }> = {};
  const range = { from: '2026-11-01', to: '2026-11-10' };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: milestone 9 gate', ({ executeSql }) => executeSql(text, values));
  const as = (userId: string): Promise<ActorContext> =>
    resolveActor(db, { userId, tenantId: org.realTenantId, clock });
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

  beforeAll(async () => {
    db = appDatabase();
    operator = { ...(await superAdmin(db)), clock };
    const users = await db.identity
      .insert(schema.users)
      .values(
        ['Owner', 'Accountant', 'Viewer'].map((name) => ({
          name,
          email: `g9.${randomUUID()}@example.com`,
          emailVerified: true,
        })),
      )
      .returning({ id: schema.users.id });
    [ownerId, accountantId, viewerId] = users.map((user) => user.id) as [string, string, string];
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Gate Nueve S.A.',
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
      { keyCipher: createKeyCipher('e9'.repeat(32)), clock },
    );
    for (const featureKey of ['INVENTORY', 'PURCHASE_ORDERS', 'RECEIVABLES'])
      await setOverride(operator, db, {
        realTenantId: org.realTenantId,
        featureKey,
        effect: 'GRANT',
        limitValue: null,
        reason: 'gate',
      });
    await sql(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'ACCOUNTANT'), ($1, $3, 'VIEWER')`,
      [org.realTenantId, accountantId, viewerId],
    );

    const tenant = org.realTenantId;
    const X = '1710034065';
    const Y = '0992339411001';
    const amounts = (base: string, iva: string, total: string) => ({ base, iva, total });
    doc.A = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-10',
      buyerIdentification: X,
      amounts: amounts('100.00', '15.00', '115.00'),
    });
    doc.B = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-10',
      buyerIdentification: Y,
      amounts: amounts('200.00', '30.00', '230.00'),
    });
    doc.C = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-03',
      buyerIdentification: X,
      amounts: amounts('50.00', '7.50', '57.50'),
    });
    doc.N = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-10',
      buyerIdentification: X,
      documentType: '04',
      relatedDocumentId: doc.A.id,
      amounts: amounts('20.00', '3.00', '23.00'),
    });
    doc.V = await insertTestDocument(db, tenant, {
      issueDate: '2026-11-10',
      amounts: amounts('1000.00', '150.00', '1150.00'),
    });
    doc.O = await insertTestDocument(db, tenant, {
      issueDate: '2026-10-28',
      buyerIdentification: Y,
      amounts: amounts('80.00', '12.00', '92.00'),
    });
    doc.R = await insertTestDocument(db, tenant, { issueDate: '2026-11-09' });
    doc.W = await insertTestDocument(db, tenant, { issueDate: '2026-11-09' });
    for (const key of ['A', 'B', 'C', 'N', 'O']) await moveTo(doc[key]!.id, AUTHORIZED);
    await moveTo(doc.V.id, [...AUTHORIZED, 'VOIDED']);
    await moveTo(doc.R.id, ['PENDING_SEND', 'RETURNED']);
    await moveTo(doc.W.id, ['PENDING_SEND', 'RECEIVED']);
    // What the SRI answered, kept on every authorized or voided document.
    await sql(
      `UPDATE documents SET authorization_xml = '<autorizacion>' || access_key || '</autorizacion>'
       WHERE tenant_id = $1 AND status IN ('AUTHORIZED', 'VOIDED')`,
      [tenant],
    );

    // Stock: 10 bought at 2.00 on the 9th (Quito), 2 sold on the 10th, and one in October.
    const [warehouse] = (
      await sql(`SELECT id FROM warehouses WHERE tenant_id = $1 LIMIT 1`, [tenant])
    ).rows as { id: string }[];
    const product = (
      await sql(
        `INSERT INTO products (tenant_id, code, name, kind, price, iva_rate_code, tracks_stock)
         VALUES ($1, 'G-1', 'Café del gate', 'GOOD', '5', '4', true) RETURNING id`,
        [tenant],
      )
    ).rows[0] as { id: string };
    await sql(
      `INSERT INTO stock_levels (tenant_id, product_id, warehouse_id, on_hand) VALUES ($1, $2, $3, 8)`,
      [tenant, product.id, warehouse!.id],
    );
    await sql(
      `INSERT INTO stock_movements (tenant_id, product_id, warehouse_id, type, quantity, unit_cost, value, created_at)
       VALUES ($1, $2, $3, 'PURCHASE_RECEIPT', 10, 2, 20, '2026-11-10T04:30:00Z'),
              ($1, $2, $3, 'SALE', -2, 2, -4, '2026-11-10T14:00:00Z'),
              ($1, $2, $3, 'ADJUSTMENT_IN', 1, 2, 2, '2026-10-20T14:00:00Z')`,
      [tenant, product.id, warehouse!.id],
    );
    // Purchases: two orders from one provider in the range; a draft and a cancelled one are not.
    const provider = (
      await sql(
        `INSERT INTO providers (tenant_id, id_type, identification, name, emails)
         VALUES ($1, '04', '1790012345001', 'Proveedor del gate', '{}') RETURNING id`,
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
  });

  afterAll(() => db.close());

  it('sales: day, client and product agree with the documents worked out by hand', async () => {
    const owner = await as(ownerId);
    const byDay = await runReport(owner, db, { report: 'sales', ...range });
    // 3 Nov: C. 10 Nov: A + B - N (V is voided, R and W are not authorized, O is October).
    expect(byDay.rows).toEqual([
      ['2026-11-03', '1', '50.00', '7.50', '57.50'],
      ['2026-11-10', '2', '280.00', '42.00', '322.00'],
    ]);
    expect(byDay.totals).toEqual(['', '3', '330.00', '49.50', '379.50']);

    const byClient = await runReport(owner, db, { report: 'sales', groupBy: 'client', ...range });
    expect(byClient.rows.map((row) => [row[0], row[2], row[3], row[5]])).toEqual([
      // Y: B. X: A + C - N.
      ['0992339411001', '1', '200.00', '230.00'],
      ['1710034065', '2', '130.00', '149.50'],
    ]);
    expect(byClient.totals).toEqual(['', '', '3', '330.00', '49.50', '379.50']);

    const byProduct = await runReport(owner, db, { report: 'sales', groupBy: 'product', ...range });
    // One line each: three invoices less the credit note.
    expect(byProduct.rows).toEqual([['P-1', 'Producto', '2.000000', '330.00', '49.50', '379.50']]);
  });

  it('taxes, documents and the dashboard tell the same story', async () => {
    const owner = await as(ownerId);
    const taxes = await runReport(owner, db, { report: 'taxes', ...range });
    expect(taxes.rows).toEqual([['15.00', '330.00', '49.50', '379.50']]);

    const issued = await runReport(owner, db, { report: 'documents', ...range });
    expect(issued.rows).toHaveLength(7);
    const statuses = issued.rows.reduce<Record<string, number>>((count, row) => {
      count[row[5]!] = (count[row[5]!] ?? 0) + 1;
      return count;
    }, {});
    expect(statuses).toEqual({ AUTHORIZED: 4, VOIDED: 1, RETURNED: 1, RECEIVED: 1 });

    const figures = await dashboard(owner, db);
    expect(figures.sales).toEqual({
      today: { total: '322.00', count: 2 },
      month: { total: '379.50', count: 3 },
    });
    // The dashboard counts the month's documents and what is still open: the same seven.
    expect(figures.documents).toMatchObject({ AUTHORIZED: 4, VOIDED: 1, RETURNED: 1, RECEIVED: 1 });
    expect(figures.topProducts).toEqual([
      { code: 'P-1', name: 'Producto', quantity: '3.000000', base: '350.00' },
    ]);
    // The sales report and the tax summary add up to the same net sales.
    expect(taxes.totals![3]).toBe(figures.sales!.month.total);
  });

  it('stock movements, purchases and receivables read what was seeded', async () => {
    const owner = await as(ownerId);
    const movements = await runReport(owner, db, { report: 'movements', ...range });
    expect(movements.rows.map((row) => [row[0], row[1], row[5], row[7]])).toEqual([
      // 23:30 in Quito on the 9th is already the 10th in UTC: the report keeps Ecuador's day.
      ['2026-11-09', 'PURCHASE_RECEIPT', '10.000000', '20.000000'],
      ['2026-11-10', 'SALE', '-2.000000', '-4.000000'],
    ]);

    const purchases = await runReport(owner, db, { report: 'purchases', ...range });
    expect(purchases.rows).toEqual([
      ['1790012345001', 'Proveedor del gate', '2', '140.00', '21.00', '161.00'],
    ]);

    // Receivables: authorized invoices with a balance. Nothing has been collected, so each
    // invoice without a credit note owes its total.
    const aging = await agingReport(owner, db);
    const balance = (id: string) => aging.rows.find((row) => row.id === id)?.balance;
    expect(balance(doc.B!.id)).toBe('230.00');
    expect(balance(doc.C!.id)).toBe('57.50');
    expect(balance(doc.O!.id)).toBe('92.00');
    expect(aging.rows.some((row) => [doc.V!.id, doc.R!.id, doc.W!.id].includes(row.id))).toBe(
      false,
    );
    const listed = await runReport(owner, db, { report: 'aging' });
    expect(listed.totals![9]).toBe(aging.total);
  });

  it('the accountant gets every authorization of the month in a ZIP, and only they may', async () => {
    const accountant = await as(accountantId);
    const made = await accountantExport(accountant, db, '2026-11');
    // A, B, C and the credit note are authorized; V was voided afterwards; O is October's.
    expect(made).toMatchObject({ filename: 'comprobantes-2026-11.zip', authorized: 4, voided: 1 });
    const files = unzip(made.zip);
    expect(files.size).toBe(5);
    const names = [...files.keys()];
    expect(names.filter((name) => name.startsWith('autorizados/'))).toHaveLength(4);
    expect(names.filter((name) => name.startsWith('anulados/'))).toHaveLength(1);
    expect(names.some((name) => name.includes('04-'))).toBe(true);
    const keys = await sql(
      `SELECT access_key FROM documents WHERE tenant_id = $1 AND status IN ('AUTHORIZED', 'VOIDED') AND issue_date >= '2026-11-01'`,
      [org.realTenantId],
    );
    expect([...files.values()].sort()).toEqual(
      (keys.rows as { access_key: string }[])
        .map((row) => `<autorizacion>${row.access_key}</autorizacion>`)
        .sort(),
    );

    // Reading is for more roles than exporting is.
    const viewer = await as(viewerId);
    await expect(runReport(viewer, db, { report: 'sales', ...range })).resolves.toBeTruthy();
    expect(await failure(accountantExport(viewer, db, '2026-11'))).toBe('FORBIDDEN');
    expect(
      await failure(runReport(viewer, db, { report: 'sales', ...range }, { export: true })),
    ).toBe('FORBIDDEN');
  });

  it('email templates are editable: a draft shows in the preview, a published text reaches the next email', async () => {
    const ref = { template: 'quotaNearing', locale: 'es' } as const;
    const original = DEFAULT_COPY.es.quotaNearing;
    const edited = {
      ...original,
      heading: 'Tu cupo se está llenando',
      body: 'Usaste el 80 % de los {count} documentos de este período.',
    };
    await draftEmailTemplate(operator, db, { ...ref, ...edited });
    const preview = await previewEmailTemplate(operator, db, { ...ref, ...edited });
    expect(preview.html).toContain('Tu cupo se está llenando');
    // Not published: companies still get the version in use.
    await expect(loadCopy(db, ref.template, ref.locale)).resolves.toMatchObject({
      heading: original.heading,
    });

    await publishEmailTemplate(operator, db, ref);
    const messages: EmailMessage[] = [];
    const handler = sendEmailHandler(
      {
        send: (message) => {
          messages.push(message);
          return Promise.resolve('sent');
        },
      },
      (template, locale) => loadCopy(db, template, locale),
    );
    await handler({
      data: {
        to: 'owner@example.com',
        locale: 'es',
        template: 'quotaNearing',
        params: { url: 'https://app.test/es/plan', organization: 'Gate Nueve S.A.', count: '300' },
      },
    });
    expect(messages[0]!.html).toContain('Tu cupo se está llenando');
    expect(messages[0]!.html).toContain('Usaste el 80 % de los 300 documentos de este período.');
    // English is its own text, untouched.
    await handler({
      data: {
        to: 'owner@example.com',
        locale: 'en',
        template: 'quotaNearing',
        params: { url: 'https://app.test/en/plan', organization: 'Gate Nueve S.A.', count: '300' },
      },
    });
    expect(messages[1]!.html).toContain(DEFAULT_COPY.en.quotaNearing.heading);

    // Put back as a new version: history keeps both.
    await draftFromVersion(operator, db, { ...ref, version: 1 });
    await publishEmailTemplate(operator, db, ref);
    const detail = await getEmailTemplate(operator, db, ref);
    expect(detail.current?.heading).toBe(original.heading);
    expect(detail.versions.length).toBeGreaterThanOrEqual(3);
  });
});
