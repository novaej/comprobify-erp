import { randomUUID } from 'node:crypto';
import {
  companySettings,
  createKeyCipher,
  fixedClock,
  onboardOrganization,
  resolveActor,
  type CreatedOrganization,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument } from './helpers';

// FR-BULK-1, FR-BULK-2 (ADR-026): what the database itself refuses for batches and their items.
describe('bulk batch tables', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let org: CreatedOrganization;
  let pointId: string;
  let documentId: string;

  const tenantId = () => org.twinTenantId;
  const sql = (reason: string, text: string, values: unknown[] = []) =>
    db.withSystem(`test: ${reason}`, ({ executeSql }) => executeSql(text, values));
  const newBatch = async () => {
    const [batch] = await db.withSystem('test: start a batch', ({ db: tx }) =>
      tx
        .insert(schema.bulkBatches)
        .values({
          tenantId: tenantId(),
          source: 'CSV',
          issuePointId: pointId,
          totalItems: 1,
        })
        .returning({ id: schema.bulkBatches.id }),
    );
    return batch!.id;
  };
  const newItem = async (
    batchId: string,
    values: Partial<typeof schema.bulkBatchItems.$inferInsert>,
  ) => {
    const [item] = await db.withSystem('test: add an item', ({ db: tx }) =>
      tx
        .insert(schema.bulkBatchItems)
        .values({ tenantId: tenantId(), batchId, position: 1, input: {}, ...values })
        .returning({ id: schema.bulkBatchItems.id }),
    );
    return item!.id;
  };
  const move = (reason: string, table: string, id: string, set: string) =>
    sql(reason, `UPDATE ${table} SET ${set} WHERE id = $1`, [id]);

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `bs.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: user!.id,
        ruc,
        legalName: 'Sigma S.A.',
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
      { keyCipher: createKeyCipher('b1'.repeat(32)), clock },
    );
    const actor = await resolveActor(db, {
      userId: user!.id,
      tenantId: tenantId(),
      clock,
    });
    pointId = (await companySettings(actor, db)).branches[0]!.issuePoints[0]!.id;
    documentId = (await insertTestDocument(db, tenantId())).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the triggers equal to the definitions they are generated from', async () => {
    const source = async (name: string) =>
      (await sql('read a trigger', `SELECT prosrc FROM pg_proc WHERE proname = $1`, [name]))
        .rows[0] as { prosrc: string };
    expect((await source('app_batch_status_check')).prosrc).toContain(
      schema.batchStatusTriggerBody(),
    );
    expect((await source('app_batch_item_status_check')).prosrc).toContain(
      schema.batchItemStatusTriggerBody(),
    );
  });

  it('moves an item only along its machine, and a retry goes back to the queue', async () => {
    const batch = await newBatch();
    const item = await newItem(batch, {});
    const table = 'bulk_batch_items';
    await expect(move('skip creating', table, item, `status = 'CREATED'`)).rejects.toThrow(
      /can not become/,
    );
    await move('claim', table, item, `status = 'CREATING'`);
    await move(
      'fail',
      table,
      item,
      `status = 'FAILED', error_code = 'QUOTA_EXCEEDED', error_message = 'used up'`,
    );
    await expect(move('skip the queue', table, item, `status = 'CREATING'`)).rejects.toThrow(
      /can not become/,
    );
    await move('retry', table, item, `status = 'QUEUED', error_code = NULL, error_message = NULL`);
    await move('claim again', table, item, `status = 'CREATING'`);
    await move('create', table, item, `status = 'CREATED', document_id = '${documentId}'`);
    await expect(move('undo', table, item, `status = 'QUEUED'`)).rejects.toThrow(/can not become/);
  });

  it('refuses an item that names both an order and a row, or neither, and a failure without a code', async () => {
    const batch = await newBatch();
    await expect(newItem(batch, { input: null })).rejects.toThrow();
    await expect(
      sql(
        'a failure with no code',
        `INSERT INTO bulk_batch_items (tenant_id, batch_id, position, status, input)
         VALUES ($1, $2, 9, 'FAILED', '{}')`,
        [tenantId(), batch],
      ),
    ).rejects.toThrow();
  });

  it('closes and reopens a batch, and refuses two items at one position', async () => {
    const batch = await newBatch();
    const table = 'bulk_batches';
    await expect(
      move('complete without a time', table, batch, `status = 'COMPLETED'`),
    ).rejects.toThrow();
    await move('complete', table, batch, `status = 'COMPLETED', completed_at = now()`);
    await move('reopen', table, batch, `status = 'PROCESSING', completed_at = NULL`);
    await newItem(batch, { position: 3 });
    await expect(newItem(batch, { position: 3 })).rejects.toThrow();
  });

  it('gives the app role no way to delete', async () => {
    const batch = await newBatch();
    await expect(
      db.withTenant({ tenantId: tenantId() }, ({ executeSql }) =>
        executeSql(`DELETE FROM bulk_batches WHERE id = $1`, [batch]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
