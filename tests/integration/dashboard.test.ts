import { randomUUID } from 'node:crypto';
import {
  createKeyCipher,
  dashboard,
  fixedClock,
  lowStock,
  onboardOrganization,
  resolveActor,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument } from './helpers';

// FR-REP-1: what the dashboard reads of a company's documents, stock, quota and certificate.
describe('dashboard', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let ownerId: string;
  let viewerId: string;
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: dashboard setup', ({ executeSql }) => executeSql(text, values));
  const actor = (userId = ownerId) =>
    resolveActor(db, { userId, tenantId: org.realTenantId, clock });
  // Moves a document along SRI's path, one allowed step at a time.
  const moveTo = async (id: string, path: string[]) => {
    for (const status of path)
      await sql('UPDATE documents SET status = $1 WHERE id = $2', [status, id]);
  };
  const AUTHORIZED = ['PENDING_SEND', 'RECEIVED', 'AUTHORIZED'];

  beforeAll(async () => {
    db = appDatabase();
    const users = await db.identity
      .insert(schema.users)
      .values([
        { name: 'Owner', email: `db.${randomUUID()}@example.com`, emailVerified: true },
        { name: 'Viewer', email: `db.${randomUUID()}@example.com`, emailVerified: true },
      ])
      .returning({ id: schema.users.id });
    ownerId = users[0]!.id;
    viewerId = users[1]!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Kappa S.A.',
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2026-11-25'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('d4'.repeat(32)), clock },
    );
    await sql(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'VIEWER'), ($3, $2, 'VIEWER')`,
      [org.realTenantId, viewerId, org.twinTenantId],
    );
  });

  afterAll(() => db.close());

  it('adds up the day and the month, by status, with what sold most', async () => {
    const today = await insertTestDocument(db, org.realTenantId, { issueDate: '2026-11-10' });
    const earlier = await insertTestDocument(db, org.realTenantId, { issueDate: '2026-11-03' });
    const lastMonth = await insertTestDocument(db, org.realTenantId, { issueDate: '2026-10-28' });
    const waiting = await insertTestDocument(db, org.realTenantId, { issueDate: '2026-11-09' });
    const returned = await insertTestDocument(db, org.realTenantId, { issueDate: '2026-11-09' });
    const oldReturned = await insertTestDocument(db, org.realTenantId, { issueDate: '2026-10-02' });
    for (const document of [today, earlier, lastMonth]) await moveTo(document.id, AUTHORIZED);
    await moveTo(waiting.id, ['PENDING_SEND', 'RECEIVED']);
    await moveTo(returned.id, ['PENDING_SEND', 'RETURNED']);
    await moveTo(oldReturned.id, ['PENDING_SEND', 'RETURNED']);
    // A voided invoice is no sale.
    const voided = await insertTestDocument(db, org.realTenantId, { issueDate: '2026-11-10' });
    await moveTo(voided.id, [...AUTHORIZED, 'VOIDED']);

    const figures = await dashboard(await actor(), db);
    expect(figures).toMatchObject({ today: '2026-11-10', monthStart: '2026-11-01' });
    expect(figures.sales).toEqual({
      today: { total: '11.50', count: 1 },
      month: { total: '23.00', count: 2 },
    });
    // This month's, and last month's that are still open; the old authorized one is not counted.
    expect(figures.documents).toEqual({
      SIGNED: 0,
      PENDING_SEND: 0,
      RECEIVED: 1,
      RETURNED: 2,
      SEND_FAILED: 0,
      AUTHORIZED: 2,
      NOT_AUTHORIZED: 0,
      VOIDED: 1,
    });
    expect(figures.topProducts).toEqual([
      { code: 'P-1', name: 'Producto', quantity: '2.000000', base: '20.00' },
    ]);
    expect(figures.certificate).toMatchObject({ state: 'expiring', daysLeft: 14 });
    // The free plan has a quota and no inventory.
    expect(figures.quota).toMatchObject({ limit: 5 });
    expect(figures.lowStock).toBeNull();
  });

  it('subtracts credit notes from the sales', async () => {
    const note = await insertTestDocument(db, org.realTenantId, {
      issueDate: '2026-11-10',
      documentType: '04',
      relatedDocumentId: (
        await sql(
          `SELECT id FROM documents WHERE tenant_id = $1 AND document_type = '01' LIMIT 1`,
          [org.realTenantId],
        )
      ).rows[0]!.id as string,
      amounts: { base: '2.00', iva: '0.30', total: '2.30' },
    });
    await moveTo(note.id, AUTHORIZED);
    const { sales } = await dashboard(await actor(), db);
    expect(sales).toEqual({
      today: { total: '9.20', count: 1 },
      month: { total: '20.70', count: 2 },
    });
  });

  it('lists stocked products with nothing left available', async () => {
    const [warehouse] = (
      await sql(`SELECT id FROM warehouses WHERE tenant_id = $1 LIMIT 1`, [org.realTenantId])
    ).rows as { id: string }[];
    const make = async (name: string, onHand: string, reserved: string) => {
      const { rows } = await sql(
        `INSERT INTO products (tenant_id, code, name, kind, price, iva_rate_code, tracks_stock)
         VALUES ($1, $2, $3, 'GOOD', '5', '4', true) RETURNING id`,
        [org.realTenantId, `S-${randomUUID().slice(0, 6)}`, name],
      );
      await sql(
        `INSERT INTO stock_levels (tenant_id, product_id, warehouse_id, on_hand, reserved)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.realTenantId, (rows[0] as { id: string }).id, warehouse!.id, onHand, reserved],
      );
    };
    await make('Agotado', '0', '0');
    await make('Retenido', '3', '3');
    await make('Con stock', '8', '2');
    const rows = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      lowStock(tx, org.realTenantId),
    );
    expect(rows.map((row) => row.name)).toEqual(['Agotado', 'Retenido']);
  });

  it('draws only what the role reaches', async () => {
    // A viewer reads reports, but not billing: no quota.
    const figures = await dashboard(await actor(viewerId), db);
    expect(figures.sales).not.toBeNull();
    expect(figures.quota).toBeNull();
  });
});
