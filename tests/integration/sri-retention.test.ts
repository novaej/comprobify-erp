import { randomUUID } from 'node:crypto';
import {
  createKeyCipher,
  documentExchanges,
  fixedClock,
  onboardOrganization,
  pruneSriRaw,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument, superAdmin, testLogger } from './helpers';

// FR-DOC-13: what SRI answered, kept as history; its raw copy only for the retention period, and
// readable by the operator for support.
describe('SRI exchanges: retention and support', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let admin: PlatformActor;
  let org: CreatedOrganization;
  let document: { id: string; accessKey: string };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: sri retention', ({ executeSql }) => executeSql(text, values));
  const exchange = (operation: string, outcome: string, occurredAt: string, raw: string | null) =>
    sql(
      `INSERT INTO sri_exchanges (tenant_id, document_id, operation, outcome, source, host, http_status, raw, duration_ms, occurred_at)
       VALUES ($1, $2, $3, $4, 'mock', 'celcer', 200, $5, 40, $6)`,
      [org.realTenantId, document.id, operation, outcome, raw, occurredAt],
    );

  beforeAll(async () => {
    db = appDatabase();
    admin = { ...(await superAdmin(db)), clock };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `sr.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: 'Tau Soporte S.A.',
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
      { keyCipher: createKeyCipher('c5'.repeat(32)), clock },
    );
    document = await insertTestDocument(db, org.realTenantId);
    // Day 91 back from the 10th of November is the 11th of August: older than 90 days.
    await exchange('reception', 'RECEIVED', '2026-08-10T10:00:00Z', '<respuesta>vieja</respuesta>');
    await exchange(
      'authorization',
      'AUTHORIZED',
      '2026-08-12T10:00:00Z',
      '<respuesta>reciente</respuesta>',
    );
    await exchange('validity', 'NOT_FOUND', '2026-11-10T14:00:00Z', '<respuesta>hoy</respuesta>');
  });

  afterAll(() => db.close());

  it('lets the database clear a raw copy and nothing else about an exchange', async () => {
    const { rows } = await sql(
      `SELECT id FROM sri_exchanges WHERE document_id = $1 AND operation = 'validity'`,
      [document.id],
    );
    const id = (rows[0] as { id: string }).id;
    // The app role has no right to the other columns...
    await expect(
      sql(`UPDATE sri_exchanges SET outcome = 'AUTHORIZED' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({
      code: '42501',
    });
    // ...and may only empty `raw`, never fill or change it.
    await expect(
      sql(`UPDATE sri_exchanges SET raw = 'otra cosa' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({
      code: '23514',
    });
    await expect(sql(`DELETE FROM sri_exchanges WHERE id = $1`, [id])).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('clears only the copies past 90 days, keeps the rows, and is safe to run again', async () => {
    const run = () => pruneSriRaw({ db, clock, logger: testLogger() });
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    const { rows } = await sql(
      `SELECT operation, outcome, raw FROM sri_exchanges WHERE document_id = $1 ORDER BY occurred_at`,
      [document.id],
    );
    expect(rows).toEqual([
      { operation: 'reception', outcome: 'RECEIVED', raw: null },
      { operation: 'authorization', outcome: 'AUTHORIZED', raw: '<respuesta>reciente</respuesta>' },
      { operation: 'validity', outcome: 'NOT_FOUND', raw: '<respuesta>hoy</respuesta>' },
    ]);
  });

  it('shows the operator every call for a document, by its access key, and records the look', async () => {
    const view = await documentExchanges(admin, db, document.accessKey);
    expect(view).toMatchObject({
      company: 'Tau Soporte S.A.',
      isTwin: false,
      documentType: '01',
      accessKey: document.accessKey,
    });
    expect(view!.number).toMatch(/^001-001-\d{9}$/);
    expect(view!.exchanges.map((entry) => [entry.operation, entry.raw === null])).toEqual([
      ['reception', true],
      ['authorization', false],
      ['validity', false],
    ]);
    expect(view!.exchanges[0]).toMatchObject({ source: 'mock', host: 'celcer', httpStatus: 200 });

    const audit = await sql(
      `SELECT details FROM platform_audit_events WHERE action = 'document.exchanges_viewed' AND details->>'documentId' = $1`,
      [document.id],
    );
    expect(audit.rows).toHaveLength(1);
    // Another key finds nothing, and nobody else may look.
    expect(await documentExchanges(admin, db, '1'.repeat(49))).toBeNull();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Nadie', email: `sr.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    await expect(
      documentExchanges(
        { userId: user!.id, isSuperAdmin: true as const, clock },
        db,
        document.accessKey,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
