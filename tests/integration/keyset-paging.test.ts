import { randomUUID } from 'node:crypto';
import {
  createOrganization,
  DOCUMENTS_PAGE_SIZE,
  fixedClock,
  listDocuments,
  resolveActor,
  type ActorContext,
  type DocumentFilters,
} from '@comprobify/core';
import { testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument } from './helpers';

// NFR-PERF-4: Comprobantes pages by keyset; walking it forward and back meets every row once.
describe('keyset paging of Comprobantes', () => {
  const clock = fixedClock('2026-11-18T15:00:00Z');
  let db: Database;
  let owner: ActorContext;
  const made: string[] = [];

  beforeAll(async () => {
    db = appDatabase();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `ks.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const org = await createOrganization(db, {
      ownerUserId: user!.id,
      ruc: testRuc(),
      legalName: 'Keyset S.A.',
      tradeName: null,
      mainAddress: 'Quito',
      branch: { code: '001', name: 'Matriz', address: null },
      issuePointCode: '001',
    });
    owner = await resolveActor(db, { userId: user!.id, tenantId: org.twinTenantId, clock });
    // Two pages and a bit, over three days, with equal totals to make ties.
    for (let i = 0; i < DOCUMENTS_PAGE_SIZE * 2 + 3; i++) {
      const total = (10 + (i % 4)).toFixed(2);
      const document = await insertTestDocument(db, org.twinTenantId, {
        issueDate: `2026-11-1${i % 3}`,
        amounts: { base: total, iva: '0.00', total },
      });
      made.push(document.id);
    }
  });
  afterAll(() => db.close());

  const walk = async (filters: DocumentFilters) => {
    const forward: string[] = [];
    const pages = [];
    let page = await listDocuments(owner, db, filters);
    expect(page.previous).toBeNull();
    pages.push(page);
    forward.push(...page.rows.map((row) => row.id));
    while (page.next) {
      page = await listDocuments(owner, db, { ...filters, after: page.next });
      pages.push(page);
      forward.push(...page.rows.map((row) => row.id));
    }
    // And back from the last page to the first, page by page.
    const back: string[][] = [page.rows.map((row) => row.id)];
    while (page.previous) {
      page = await listDocuments(owner, db, { ...filters, before: page.previous });
      back.unshift(page.rows.map((row) => row.id));
    }
    expect(page.previous).toBeNull();
    return { forward, pages, back };
  };

  it('meets every document once, newest first, and comes back the same way', async () => {
    const { forward, pages, back } = await walk({});
    expect(new Set(forward).size).toBe(made.length);
    expect(forward).toHaveLength(made.length);
    expect(pages.map((page) => page.rows.length)).toEqual([25, 25, 3]);
    expect(back.flat()).toEqual(forward);
    const dates = (await listDocuments(owner, db, {})).rows.map((row) => row.issueDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('keeps a chosen order, ties and all', async () => {
    const { forward, back } = await walk({ sort: 'total', direction: 'asc' });
    expect(new Set(forward).size).toBe(made.length);
    expect(back.flat()).toEqual(forward);
  });

  it('reads a cursor it did not make as the first page', async () => {
    const first = await listDocuments(owner, db, {});
    const odd = await listDocuments(owner, db, { after: 'not-a-cursor' });
    expect(odd.rows.map((row) => row.id)).toEqual(first.rows.map((row) => row.id));
  });
});
