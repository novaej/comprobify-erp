import { randomUUID } from 'node:crypto';
import { createOrganization, takeSequential, type CreatedOrganization } from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { documentStatusTriggerBody, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument } from './helpers';

// FR-DOC-3, FR-DOC-13, SRI rules 5, 7 and 9.
describe('document core', () => {
  let db: Database;
  let org: CreatedOrganization;

  const update = (id: string, set: string, values: unknown[] = []) =>
    db.withSystem('test: change a document', ({ executeSql }) =>
      executeSql(`UPDATE documents SET ${set} WHERE id = $1`, [id, ...values]),
    );

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `dc.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: 'Pi S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
  });

  afterAll(() => db.close());

  it('runs the status trigger generated from the TypeScript definition (rule 17)', async () => {
    const source = await db.withSystem('test: read the trigger function', ({ executeSql }) =>
      executeSql<{ prosrc: string }>(
        `SELECT prosrc FROM pg_proc WHERE proname = 'app_document_status_check'`,
      ),
    );
    expect(source.rows[0]!.prosrc).toContain(documentStatusTriggerBody());
  });

  it('takes sequentials in order, without gaps or repeats, even at the same time', async () => {
    const issuePointId = await db.withTenant({ tenantId: org.realTenantId }, async ({ db: tx }) => {
      const [point] = await tx.select({ id: schema.issuePoints.id }).from(schema.issuePoints);
      return point!.id;
    });
    const take = () =>
      db.withSystem('test: take a sequential', ({ db: tx }) =>
        takeSequential(tx, { tenantId: org.realTenantId, issuePointId, documentType: '01' }),
      );
    const taken = await Promise.all(Array.from({ length: 8 }, take));
    expect([...taken].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // A rolled-back document gives its number back.
    await expect(
      db.withSystem('test: a document that fails', async ({ db: tx }) => {
        await takeSequential(tx, { tenantId: org.realTenantId, issuePointId, documentType: '01' });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    await expect(take()).resolves.toBe(9);
    await expect(
      db.withSystem('test: a type not enabled', ({ db: tx }) =>
        takeSequential(tx, { tenantId: org.realTenantId, issuePointId, documentType: '04' }),
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_NOT_ENABLED' });
  });

  it('refuses a transition the machine doesn’t allow, and anything after VOIDED', async () => {
    const document = await insertTestDocument(db, org.twinTenantId);
    await expect(update(document.id, `status = 'AUTHORIZED'`)).rejects.toMatchObject({
      code: '23514',
    });
    for (const status of ['PENDING_SEND', 'RECEIVED', 'AUTHORIZED', 'VOIDED'])
      await update(document.id, `status = '${status}'`);
    await expect(update(document.id, `status = 'SIGNED'`)).rejects.toMatchObject({ code: '23514' });
  });

  it('never changes the number, sets the authorization once, and the content only on SIGNED', async () => {
    const document = await insertTestDocument(db, org.twinTenantId);
    await expect(update(document.id, 'sequential = 999')).rejects.toMatchObject({ code: '23514' });
    await expect(update(document.id, `total = '1.00'`)).rejects.toMatchObject({ code: '23514' });

    for (const status of ['PENDING_SEND', 'RECEIVED'])
      await update(document.id, `status = '${status}'`);
    await update(document.id, `status = 'AUTHORIZED', authorization_number = $2`, [
      document.accessKey,
    ]);
    await expect(update(document.id, `authorization_number = '123'`)).rejects.toMatchObject({
      code: '23514',
    });

    // Returned, then corrected: the same row and number go back to SIGNED with new content.
    const returned = await insertTestDocument(db, org.twinTenantId);
    await update(returned.id, `status = 'PENDING_SEND'`);
    await update(returned.id, `status = 'RETURNED'`);
    await update(returned.id, `status = 'SIGNED', total = '12.00', revision = 2`);
    const [row] = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, returned.id)),
    );
    expect(row).toMatchObject({ sequential: returned.sequential, total: '12.00', revision: 2 });
  });

  it('never updates lines, payments or events: corrections add, the timeline grows', async () => {
    const document = await insertTestDocument(db, org.twinTenantId);
    for (const table of ['document_lines', 'document_payments', 'document_events'])
      await expect(
        db.withSystem('test: rewrite a document part', ({ executeSql }) =>
          executeSql(`UPDATE ${table} SET tenant_id = tenant_id WHERE document_id = $1`, [
            document.id,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps the access key unique across tenants (SRI rule 5)', async () => {
    const document = await insertTestDocument(db, org.twinTenantId);
    const other = await insertTestDocument(db, org.realTenantId);
    // The one way to a new key: back to SIGNED after a failed send.
    await update(other.id, `status = 'PENDING_SEND'`);
    await update(other.id, `status = 'SEND_FAILED'`);
    await expect(
      update(other.id, `status = 'SIGNED', access_key = $2`, [document.accessKey]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
