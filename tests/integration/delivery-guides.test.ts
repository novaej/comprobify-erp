import { randomUUID } from 'node:crypto';
import {
  checkAuthorization,
  companySettings,
  correctGuide,
  createClient,
  createGuide,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createSriClient,
  guideDraft,
  guideFromInvoice,
  fixedClock,
  documentRide,
  getDocument,
  onboardOrganization,
  resolveActor,
  sendDocument,
  setIssuePointDocumentType,
  setOverride,
  validateXml,
  type CreatedOrganization,
  type GuideInput,
  type IssueDeps,
  type IssuedDocument,
  type Jobs,
  type MockSri,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-SAL-9, FR-DOC-7: guías de remisión.
describe('delivery guides', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('c4'.repeat(32));
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
  const guide = (extra: Partial<GuideInput> = {}): GuideInput => ({
    issuePointId: pointId,
    departureAddress: 'Av. Amazonas N24-03, Quito',
    carrier: { idType: '04', identification: '1790012345001', name: 'Transportes Andes S.A.' },
    transportStart: '2026-11-10',
    transportEnd: '2026-11-11',
    plate: 'PCQ-1234',
    recipients: [
      {
        identification: '1710034065',
        name: 'María López',
        address: 'Guayaquil',
        reason: 'Venta',
        lines: [{ name: 'Café', code: 'A', quantity: '4' }],
      },
    ],
    ...extra,
  });

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
      .values({ name: 'Owner', email: `gd.${randomUUID()}@example.com`, emailVerified: true })
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
      featureKey: 'DOC_TYPE_06',
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
      documentType: '06',
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

  it('signs a guía for an invoice, stores it linked with zero totals, and enqueues the send', async () => {
    const origin = await authorized();
    const note = await createGuide(await owner(), db, guide({ originId: origin.id }), issueDeps);
    expect(note).toMatchObject({ number: '001-001-000000001', status: 'SIGNED', total: '0.00' });
    expect(note.accessKey.slice(8, 10)).toBe('06');

    const stored = await row(note);
    expect(stored).toMatchObject({
      documentType: '06',
      relatedDocumentId: origin.id,
      buyerName: 'María López',
      buyerIdType: '05',
      subtotal: '0.00',
    });
    await expect(validateXml(stored.signedXml!, '06')).resolves.toEqual({ valid: true });
    expect(stored.signedXml).toContain('<placa>PCQ-1234</placa>');

    const detail = await getDocument(await owner(), db, note.id);
    expect(detail.origin).toMatchObject({ id: origin.id });
    expect(detail.transport).toMatchObject({
      plate: 'PCQ-1234',
      recipients: [{ lines: [{ name: 'Café', quantity: '4.000000' }] }],
    });
    // A guía has no issue date to move, so it is never re-issued.
    expect(detail.allowed.reissue).toBe(false);
    expect((await getDocument(await owner(), db, origin.id)).allowed.guide).toBe(true);
  });

  it('works without an invoice, and goes through SRI like any other document', async () => {
    const note = await createGuide(await owner(), db, guide(), issueDeps);
    expect((await row(note)).relatedDocumentId).toBeNull();
    await sendDocument(deps, ref(note));
    await checkAuthorization(deps, ref(note));
    expect((await row(note)).status).toBe('AUTHORIZED');
    const ride = await documentRide(await owner(), db, note.id);
    expect(ride.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('dates the guía by its transport start, which is what SRI checks the key against (error 58)', async () => {
    const note = await createGuide(
      await owner(),
      db,
      guide({ transportStart: '2026-11-11', transportEnd: '2026-11-12' }),
      issueDeps,
    );
    expect(note.accessKey.slice(0, 8)).toBe('11112026');
    const stored = await row(note);
    expect(stored.issueDate).toBe('2026-11-11');
    expect(stored.signedXml).toContain('<fechaIniTransporte>11/11/2026</fechaIniTransporte>');
  });

  it('refuses a transport that starts before the day it is sent (SRI error 82)', async () => {
    expect(
      await failure(
        createGuide(await owner(), db, guide({ transportStart: '2026-11-09' }), issueDeps),
      ),
    ).toBe('TRANSPORT_START_BEFORE_ISSUE');
    expect(
      await failure(
        createGuide(
          await owner(),
          db,
          guide({ transportStart: '2026-11-12', transportEnd: '2026-11-11' }),
          issueDeps,
        ),
      ),
    ).toBe('TRANSPORT_END_BEFORE_START');
  });

  it('refuses an origin that is not an invoice, and the numbers are not taken by a refusal', async () => {
    const origin = await authorized();
    const other = await createGuide(await owner(), db, guide({ originId: origin.id }), issueDeps);
    expect(
      await failure(createGuide(await owner(), db, guide({ originId: other.id }), issueDeps)),
    ).toBe('ORIGIN_NOT_INVOICE');
    const next = await createGuide(await owner(), db, guide(), issueDeps);
    expect(next.sequential).toBe(other.sequential + 1);
  });

  it('is corrected as the same row, and a later day holds the dates against that day', async () => {
    const note = await createGuide(await owner(), db, guide(), issueDeps);
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await sendDocument(deps, ref(note));
    expect((await row(note)).status).toBe('RETURNED');

    const draft = await guideDraft(await owner(), db, note.id);
    expect(draft).toMatchObject({
      issuePoint: '001-001',
      content: { plate: 'PCQ-1234', transportStart: '2026-11-10' },
    });
    // The next day the start date is in the past: it must move.
    clock.set('2026-11-11T15:00:00Z');
    expect(await failure(correctGuide(await owner(), db, note.id, draft.content, issueDeps))).toBe(
      'TRANSPORT_START_BEFORE_ISSUE',
    );
    const corrected = await correctGuide(
      await owner(),
      db,
      note.id,
      {
        ...draft.content,
        transportStart: '2026-11-11',
        transportEnd: '2026-11-12',
        plate: 'PBA-0001',
      },
      issueDeps,
    );
    expect(corrected).toMatchObject({ id: note.id, number: note.number, status: 'SIGNED' });
    // The key follows the new start date.
    expect(corrected.accessKey.slice(0, 8)).toBe('11112026');
    expect((await row(note)).issueDate).toBe('2026-11-11');
    expect((await row(note)).signedXml).toContain('<placa>PBA-0001</placa>');
  });

  it('starts the form from the invoice it goes with', async () => {
    const origin = await authorized();
    const from = await guideFromInvoice(await owner(), db, origin.id);
    expect(from).toMatchObject({
      originId: origin.id,
      recipient: {
        identification: '1710034065',
        support: { number: origin.number },
        lines: [
          { code: 'A', quantity: '4.000000' },
          { code: 'B', quantity: '1.000000' },
        ],
      },
    });
  });

  it('carries the invoice authorization number into the supporting document', async () => {
    const origin = await authorized();
    const from = await guideFromInvoice(await owner(), db, origin.id);
    expect(from.recipient.support?.authorization).toMatch(/^[0-9]{10,49}$/);
  });

  it('returns the same guía for the same key and refuses another payload', async () => {
    const actor = await owner();
    const keyed = (plate: string) => guide({ plate, idempotencyKey: `gd-${plate}-k` });
    const first = await createGuide(actor, db, keyed('PCQ-1234'), issueDeps);
    const again = await createGuide(actor, db, keyed('PCQ-1234'), issueDeps);
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(
      await failure(
        createGuide(
          actor,
          db,
          { ...keyed('PBA-0001'), idempotencyKey: 'gd-PCQ-1234-k' },
          issueDeps,
        ),
      ),
    ).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('needs the Guías de remisión feature', async () => {
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOC_TYPE_06',
      effect: 'REVOKE',
      limitValue: null,
      reason: 'test',
    });
    expect(await failure(createGuide(await owner(), db, guide(), issueDeps))).toBe(
      'FEATURE_NOT_ENABLED',
    );
  });
});
