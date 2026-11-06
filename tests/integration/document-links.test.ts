import { randomUUID } from 'node:crypto';
import {
  companySettings,
  createInvoice,
  createJobs,
  createKeyCipher,
  fixedClock,
  getDocument,
  onboardOrganization,
  resolveActor,
  type CreatedOrganization,
  type IssueDeps,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, testLogger } from './helpers';

// FR-SAL-8, FR-SAL-9: a document can come from another (a credit note from its invoice).
describe('document links', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('d'.repeat(64));
  let db: Database;
  let jobs: Jobs;
  let deps: IssueDeps;
  let ownerId: string;
  let org: CreatedOrganization;
  let invoiceId: string;
  let otherTenantInvoiceId: string;
  let creditNoteId: string;

  const actor = (tenantId: string) => resolveActor(db, { userId: ownerId, tenantId, clock });
  const invoiceRow = (id: string) =>
    db.withSystem('test: read a document', async ({ db: tx }) => {
      const [row] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id));
      return row!;
    });
  // Another document of the same tenant, copied from an invoice and changed as asked.
  // The test database keeps earlier runs' rows, so the keys differ per run.
  const run = Date.now();
  let copies = 0;
  const insertCopy = (from: typeof schema.documents.$inferSelect, set: object) =>
    db.withSystem('test: insert a document', async ({ db: tx }) => {
      const id = randomUUID();
      copies += 1;
      await tx.insert(schema.documents).values({
        ...from,
        id,
        sequential: 100 + copies,
        accessKey: `${run}${copies}`.padStart(49, '7'),
        idempotencyKey: null,
        payloadHash: null,
        ...set,
      });
      return id;
    });
  // What Postgres said, including the wrapped driver error.
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
      return `${cause?.message ?? ''} ${String(error).slice(0, 200)}`;
    }
    return 'it did not fail';
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    deps = {
      jobs,
      keyCipher,
      appEnv: 'local',
      providerRuc: '1712345678001',
      consumerFinalMaxAmount: '50.00',
    };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `ln.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Sigma S.A.',
        tradeName: null,
        mainAddress: 'Av. Amazonas, Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Av. Amazonas, Quito' },
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
    const owner = await actor(org.twinTenantId);
    const point = (await companySettings(owner, db)).branches[0]!.issuePoints[0]!.id;
    const issue = async (tenantId: string, issuePointId: string) => {
      const issued = await createInvoice(
        await actor(tenantId),
        db,
        {
          issuePointId,
          clientId: null,
          lines: [{ code: 'P-1', name: 'Café', quantity: '1', unitPrice: '10', ivaRateCode: '4' }],
          payments: [{ method: '01', amount: '11.50' }],
        },
        deps,
      );
      return issued.id;
    };
    invoiceId = await issue(org.twinTenantId, point);
    // The real company has its own copy of the issue point (the twin mirrors it).
    const realPoint = (await companySettings(await actor(org.realTenantId), db)).branches[0]!
      .issuePoints[0]!.id;
    otherTenantInvoiceId = await db.withSystem('test: a document of the real company', async () => {
      const from = await invoiceRow(invoiceId);
      return insertCopy(from, {
        tenantId: org.realTenantId,
        issuePointId: realPoint,
        ambiente: '2',
      });
    });
    creditNoteId = await insertCopy(await invoiceRow(invoiceId), {
      documentType: '04',
      relatedDocumentId: invoiceId,
    });
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('shows a document its origin and what came from it, both ways', async () => {
    const owner = await actor(org.twinTenantId);
    const invoice = await getDocument(owner, db, invoiceId);
    expect(invoice.origin).toBeNull();
    expect(invoice.derived).toMatchObject([{ id: creditNoteId, documentType: '04' }]);
    const note = await getDocument(owner, db, creditNoteId);
    expect(note.derived).toEqual([]);
    expect(note.origin).toMatchObject({
      id: invoiceId,
      documentType: '01',
      number: invoice.number,
    });
  });

  it('keeps a credit note tied to an invoice and an invoice tied to nothing', async () => {
    const from = await invoiceRow(invoiceId);
    expect(
      await failure(insertCopy(from, { documentType: '04', relatedDocumentId: null })),
    ).toMatch(/documents_related_check/);
    expect(await failure(insertCopy(from, { relatedDocumentId: invoiceId }))).toMatch(
      /documents_related_check/,
    );
    const id = randomUUID();
    expect(
      await failure(insertCopy(from, { id, documentType: '06', relatedDocumentId: id })),
    ).toMatch(/documents_related_check|documents_related_fk/);
  });

  it('refuses a link to a document of another company', async () => {
    const from = await invoiceRow(invoiceId);
    expect(
      await failure(
        insertCopy(from, { documentType: '06', relatedDocumentId: otherTenantInvoiceId }),
      ),
    ).toMatch(/documents_related_fk/);
  });

  it('never lets the link change', async () => {
    const message = await failure(
      db.withSystem('test: move the link', ({ db: tx }) =>
        tx
          .update(schema.documents)
          .set({ relatedDocumentId: otherTenantInvoiceId })
          .where(eq(schema.documents.id, creditNoteId)),
      ),
    );
    expect(message).toMatch(/number and origin never change/);
  });
});
