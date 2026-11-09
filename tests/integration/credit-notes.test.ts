import { randomUUID } from 'node:crypto';
import {
  checkAuthorization,
  companySettings,
  correctCreditNote,
  createClient,
  createCreditNote,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createSriClient,
  creditBalance,
  creditNoteDraft,
  documentRide,
  fixedClock,
  getDocument,
  onboardOrganization,
  resolveActor,
  sendDocument,
  setIssuePointDocumentType,
  setOverride,
  validateXml,
  type CreatedOrganization,
  type CreditNoteInput,
  type IssueDeps,
  type IssuedDocument,
  type Jobs,
  type MockSri,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { asc, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-SAL-8, FR-DOC-9, FR-DOC-7: credit notes, held to what the invoice has left.
describe('credit notes', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('c3'.repeat(32));
  let db: Database;
  let jobs: Jobs;
  let mock: MockSri;
  let deps: SendingDeps;
  let issueDeps: IssueDeps;
  let org: CreatedOrganization;
  let ownerId: string;
  let clientId: string;
  let pointId: string;

  const owner = () => resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });
  const ref = (document: IssuedDocument) => ({
    tenantId: org.twinTenantId,
    documentId: document.id,
  });
  const row = (document: IssuedDocument) =>
    db.withTenant({ tenantId: org.twinTenantId }, async ({ db: tx }) => {
      const [found] = await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, document.id));
      return found!;
    });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };

  // 4 × 10 at 15 % and 1 × 5 at 0 %: 46.00 + 5.00.
  const invoice = async (buyer: string | null = clientId) => {
    const actor = await owner();
    const issued = await createInvoice(
      actor,
      db,
      {
        issuePointId: pointId,
        clientId: buyer,
        lines: [
          { code: 'A', name: 'Café', quantity: '4', unitPrice: '10', ivaRateCode: '4' },
          { code: 'B', name: 'Libro', quantity: '1', unitPrice: '5', ivaRateCode: '0' },
        ],
        payments: [{ method: '01', amount: '51.00' }],
      },
      issueDeps,
    );
    return issued;
  };
  const authorized = async (buyer: string | null = clientId) => {
    const document = await invoice(buyer);
    await sendDocument(deps, ref(document));
    await checkAuthorization(deps, ref(document));
    expect((await row(document)).status).toBe('AUTHORIZED');
    return document;
  };
  const credit = (
    origin: IssuedDocument,
    lines: CreditNoteInput['lines'],
    extra: Partial<CreditNoteInput> = {},
  ): CreditNoteInput => ({
    issuePointId: pointId,
    originId: origin.id,
    reason: 'Devolución de mercadería',
    lines,
    ...extra,
  });
  const issueCredit = async (origin: IssuedDocument, lines: CreditNoteInput['lines']) =>
    createCreditNote(await owner(), db, credit(origin, lines), issueDeps);
  const remaining = async (origin: IssuedDocument) =>
    (await creditBalance(await owner(), db, origin.id)).lines.map((line) => line.remainingQuantity);

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    issueDeps = {
      jobs,
      keyCipher,
      appEnv: 'local',
      providerRuc: '1712345678001',
      // The test invoice totals 51.00, and one is issued to consumidor final.
      consumerFinalMaxAmount: '100.00',
    };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `cn.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Phi S.A.',
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
    // The Notas de crédito module, then the type on the issue point (mirrored in the twin).
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOC_TYPE_04',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    const real = await resolveActor(db, {
      userId: ownerId,
      tenantId: org.realTenantId,
      clock,
    });
    const realPoint = (await companySettings(real, db)).branches[0]!.issuePoints[0]!.id;
    await setIssuePointDocumentType(real, db, {
      issuePointId: realPoint,
      documentType: '04',
      enabled: true,
    });
    pointId = (await companySettings(await owner(), db)).branches[0]!.issuePoints[0]!.id;
    clientId = (
      await createClient(await owner(), db, {
        idType: '05',
        identification: '1710034065',
        name: 'María López',
        emails: ['maria@example.com'],
      })
    ).id;
  });

  beforeEach(() => {
    clock.set('2026-11-10T15:00:00Z');
    mock = createMockSri({ now: () => clock.now() });
    deps = {
      db,
      sri: createSriClient({ transport: mock.transport }),
      jobs,
      clock,
      logger: testLogger(),
    };
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('signs a credit note of part of an invoice, stores it linked, and enqueues the send', async () => {
    const origin = await authorized();
    const note = await issueCredit(origin, [{ sourcePosition: 1, quantity: '1' }]);
    expect(note).toMatchObject({ number: '001-001-000000001', status: 'SIGNED', total: '11.50' });
    expect(note.accessKey.slice(8, 10)).toBe('04');

    const stored = await row(note);
    expect(stored).toMatchObject({
      documentType: '04',
      relatedDocumentId: origin.id,
      buyerName: 'María López',
      subtotal: '10.00',
    });
    await expect(validateXml(stored.signedXml!, '04')).resolves.toEqual({ valid: true });
    expect(stored.signedXml).toContain(`<numDocModificado>${origin.number}</numDocModificado>`);
    expect(stored.signedXml).toContain('<motivo>Devolución de mercadería</motivo>');

    const lines = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.documentLines)
        .where(eq(schema.documentLines.documentId, note.id))
        .orderBy(asc(schema.documentLines.position)),
    );
    expect(lines).toMatchObject([
      { position: 1, sourcePosition: 1, code: 'A', quantity: '1.000000', base: '10.00' },
    ]);
    const detail = await getDocument(await owner(), db, origin.id);
    expect(detail.derived).toMatchObject([{ id: note.id, documentType: '04', total: '11.50' }]);
    const jobs_ = await db.withSystem('test: read the send job', ({ executeSql }) =>
      executeSql(`SELECT 1 FROM pgboss.job WHERE name = 'sri.send' AND data->>'documentId' = $1`, [
        note.id,
      ]),
    );
    expect(jobs_.rows).toHaveLength(1);
  });

  it('credits an amount without using the line quantity, and returns can follow', async () => {
    const origin = await authorized();
    // 10.00 off line 1 (4 units, 40.00 base): quantity 1 at 10.00 on the wire.
    const discount = await issueCredit(origin, [
      { sourcePosition: 1, kind: 'AMOUNT', unitPrice: '10.00' },
    ]);
    expect(discount.total).toBe('11.50');
    const stored = await row(discount);
    await expect(validateXml(stored.signedXml!, '04')).resolves.toEqual({ valid: true });
    expect(stored.signedXml).toContain('<cantidad>1.000000</cantidad>');
    // The quantity is untouched, the amount is not.
    const [first] = (await creditBalance(await owner(), db, origin.id)).lines;
    expect(first).toMatchObject({ remainingQuantity: '4', remainingBase: '30.00' });

    // Three units come back at the invoice's price: 4 units cannot, the amount is 30.00 left.
    expect(
      await failure(
        createCreditNote(
          await owner(),
          db,
          credit(origin, [{ sourcePosition: 1, quantity: '4' }]),
          issueDeps,
        ),
      ),
    ).toBe('CREDIT_EXCEEDS_BALANCE');
    await issueCredit(origin, [{ sourcePosition: 1, quantity: '3' }]);
    expect((await creditBalance(await owner(), db, origin.id)).lines[0]).toMatchObject({
      remainingQuantity: '1',
      remainingBase: '0.00',
    });
  });

  it('refuses an amount above the line or without a value', async () => {
    const origin = await authorized();
    expect(
      await failure(
        createCreditNote(
          await owner(),
          db,
          credit(origin, [{ sourcePosition: 1, kind: 'AMOUNT', unitPrice: '40.01' }]),
          issueDeps,
        ),
      ),
    ).toBe('CREDIT_EXCEEDS_BALANCE');
    expect(
      await failure(
        createCreditNote(
          await owner(),
          db,
          credit(origin, [{ sourcePosition: 1, kind: 'AMOUNT' }]),
          issueDeps,
        ),
      ),
    ).toBe('CREDIT_AMOUNT_REQUIRED');
  });

  it('holds the next one to what is left, in quantity and in amount', async () => {
    const origin = await authorized();
    await issueCredit(origin, [{ sourcePosition: 1, quantity: '3' }]);
    expect(await remaining(origin)).toEqual(['1', '1']);

    const over = credit(origin, [{ sourcePosition: 1, quantity: '2' }]);
    expect(await failure(createCreditNote(await owner(), db, over, issueDeps))).toBe(
      'CREDIT_EXCEEDS_BALANCE',
    );
    // At the invoice's price the amount is right but a price above it is not.
    const dearer = credit(origin, [{ sourcePosition: 1, quantity: '1', unitPrice: '10.01' }]);
    expect(await failure(createCreditNote(await owner(), db, dearer, issueDeps))).toBe(
      'CREDIT_EXCEEDS_BALANCE',
    );
    // Exactly what is left works, across two lines of the same note too.
    const rest = await issueCredit(origin, [
      { sourcePosition: 1, quantity: '1' },
      { sourcePosition: 2, quantity: '1' },
    ]);
    expect(rest.total).toBe('16.50');
    expect(await remaining(origin)).toEqual(['0', '0']);
  });

  it('refuses what can not be credited', async () => {
    const owner_ = await owner();
    const unsent = await invoice();
    expect(
      await failure(
        createCreditNote(
          owner_,
          db,
          credit(unsent, [{ sourcePosition: 1, quantity: '1' }]),
          issueDeps,
        ),
      ),
    ).toBe('ORIGIN_NOT_AUTHORIZED');

    const consumer = await authorized(null);
    expect(
      await failure(
        createCreditNote(
          owner_,
          db,
          credit(consumer, [{ sourcePosition: 1, quantity: '1' }]),
          issueDeps,
        ),
      ),
    ).toBe('CREDIT_NOTE_NEEDS_BUYER');

    const origin = await authorized();
    expect(
      await failure(
        createCreditNote(
          owner_,
          db,
          credit(origin, [{ sourcePosition: 9, quantity: '1' }]),
          issueDeps,
        ),
      ),
    ).toBe('CREDIT_LINE_UNKNOWN');
    const note = await issueCredit(origin, [{ sourcePosition: 1, quantity: '1' }]);
    expect(
      await failure(
        createCreditNote(
          owner_,
          db,
          credit(note, [{ sourcePosition: 1, quantity: '1' }]),
          issueDeps,
        ),
      ),
    ).toBe('ORIGIN_NOT_INVOICE');
  });

  it('lets only one of two simultaneous credit notes spend the same balance', async () => {
    const origin = await authorized();
    const actor = await owner();
    const attempt = () =>
      createCreditNote(
        actor,
        db,
        credit(origin, [{ sourcePosition: 1, quantity: '4' }]),
        issueDeps,
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CREDIT_EXCEEDS_BALANCE' });
    expect(await remaining(origin)).toEqual(['0', '1']);
  });

  it('gives back the balance of a credit note SRI returned, and corrects it as the same row', async () => {
    const origin = await authorized();
    const note = await issueCredit(origin, [{ sourcePosition: 1, quantity: '4' }]);
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await sendDocument(deps, ref(note));
    expect((await row(note)).status).toBe('RETURNED');
    expect(await remaining(origin)).toEqual(['4', '1']);

    // Somebody else credits 3 meanwhile: the corrected note must now fit in 1.
    await issueCredit(origin, [{ sourcePosition: 1, quantity: '3' }]);
    const tooMuch = failure(
      correctCreditNote(
        await owner(),
        db,
        note.id,
        {
          reason: 'Corregido',
          lines: [{ sourcePosition: 1, quantity: '4' }],
        },
        issueDeps,
      ),
    );
    expect(await tooMuch).toBe('CREDIT_EXCEEDS_BALANCE');

    const corrected = await correctCreditNote(
      await owner(),
      db,
      note.id,
      { reason: 'Corregido', lines: [{ sourcePosition: 1, quantity: '1' }] },
      issueDeps,
    );
    expect(corrected).toMatchObject({ id: note.id, number: note.number, status: 'SIGNED' });
    expect((await row(note)).signedXml).toContain('<motivo>Corregido</motivo>');
  });

  it('stops offering a credit note once every line is credited', async () => {
    const origin = await authorized();
    expect((await getDocument(await owner(), db, origin.id)).allowed.credit).toBe(true);
    await issueCredit(origin, [{ sourcePosition: 1, quantity: '3' }]);
    // Something is left, so it is still offered.
    expect((await getDocument(await owner(), db, origin.id)).allowed.credit).toBe(true);
    await issueCredit(origin, [
      { sourcePosition: 1, quantity: '1' },
      { sourcePosition: 2, quantity: '1' },
    ]);
    // Everything is credited, even with the notes still waiting for SRI.
    expect((await getDocument(await owner(), db, origin.id)).allowed.credit).toBe(false);
    // An amount-only credit uses up the value of a line too.
    const other = await authorized();
    await issueCredit(other, [
      { sourcePosition: 1, kind: 'AMOUNT', unitPrice: '40.00' },
      { sourcePosition: 2, kind: 'AMOUNT', unitPrice: '5.00' },
    ]);
    expect((await getDocument(await owner(), db, other.id)).allowed.credit).toBe(false);
  });

  it('offers a credit note on an authorized invoice, a draft to correct, and the RIDE', async () => {
    const origin = await authorized();
    expect((await getDocument(await owner(), db, origin.id)).allowed.credit).toBe(true);
    // Not on a credit note, nor on a consumidor final invoice.
    const consumer = await authorized(null);
    expect((await getDocument(await owner(), db, consumer.id)).allowed.credit).toBe(false);

    const note = await issueCredit(origin, [{ sourcePosition: 1, quantity: '2' }]);
    expect((await getDocument(await owner(), db, note.id)).allowed.credit).toBe(false);
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await sendDocument(deps, ref(note));
    const draft = await creditNoteDraft(await owner(), db, note.id);
    expect(draft).toMatchObject({
      originId: origin.id,
      reason: 'Devolución de mercadería',
      lines: [{ sourcePosition: 1, quantity: '2.000000' }],
    });

    const other = await issueCredit(origin, [{ sourcePosition: 2, quantity: '1' }]);
    await sendDocument(deps, ref(other));
    await checkAuthorization(deps, ref(other));
    const ride = await documentRide(await owner(), db, other.id);
    expect(ride.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns the same credit note for the same key and refuses another payload', async () => {
    const origin = await authorized();
    const actor = await owner();
    const keyed = (quantity: string) =>
      credit(origin, [{ sourcePosition: 1, quantity }], { idempotencyKey: `cn-${origin.id}` });
    const first = await createCreditNote(actor, db, keyed('1'), issueDeps);
    const again = await createCreditNote(actor, db, keyed('1'), issueDeps);
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(await failure(createCreditNote(actor, db, keyed('2'), issueDeps))).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('needs the Notas de crédito feature', async () => {
    const origin = await authorized();
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOC_TYPE_04',
      effect: 'REVOKE',
      limitValue: null,
      reason: 'test',
    });
    expect(
      await failure(
        createCreditNote(
          await owner(),
          db,
          credit(origin, [{ sourcePosition: 1, quantity: '1' }]),
          issueDeps,
        ),
      ),
    ).toBe('FEATURE_NOT_ENABLED');
  });
});
