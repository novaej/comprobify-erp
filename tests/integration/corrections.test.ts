import { randomUUID } from 'node:crypto';
import {
  checkAfterDeadline,
  checkAuthorization,
  companySettings,
  correctInvoice,
  correctionDraft,
  createClient,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createSriClient,
  findByAccessKey,
  fixedClock,
  getDocument,
  listPending,
  onboardOrganization,
  reissueDocument,
  requestReissue,
  resolveActor,
  sendDocument,
  validateXml,
  voidDocument,
  type ActorContext,
  type CorrectionInput,
  type IssueDeps,
  type IssuedDocument,
  type Jobs,
  type MockSri,
  type ReissueDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { and, asc, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, testLogger } from './helpers';

// FR-DOC-6, FR-DOC-7, FR-DOC-8; SRI rules 4, 10 and 11. Fixed clocks, the mock SRI.
describe('correcting, re-issuing by hand and voiding', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('a1'.repeat(32));
  let db: Database;
  let jobs: Jobs;
  let mock: MockSri;
  let deps: ReissueDeps;
  let issueDeps: IssueDeps;
  let twinId: string;
  let ownerId: string;
  let clientId: string;

  const at = (iso: string) => clock.set(iso);
  const owner = () => resolveActor(db, { userId: ownerId, tenantId: twinId, clock });
  const ref = (document: IssuedDocument) => ({ tenantId: twinId, documentId: document.id });
  const row = (document: IssuedDocument) =>
    db.withTenant({ tenantId: twinId }, async ({ db: tx }) => {
      const [found] = await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, document.id));
      return found!;
    });
  const lines = (document: IssuedDocument) =>
    db.withTenant({ tenantId: twinId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.documentLines)
        .where(eq(schema.documentLines.documentId, document.id))
        .orderBy(asc(schema.documentLines.revision)),
    );
  const lastEvent = async (document: IssuedDocument) =>
    (
      await db.withTenant({ tenantId: twinId }, ({ db: tx }) =>
        tx
          .select()
          .from(schema.documentEvents)
          .where(eq(schema.documentEvents.documentId, document.id))
          .orderBy(asc(schema.documentEvents.occurredAt), asc(schema.documentEvents.id)),
      )
    ).at(-1)!;
  const content = (unitPrice = '10', buyer: string | null = null): CorrectionInput => {
    const total = (Number(unitPrice) * 1.15).toFixed(2);
    return {
      clientId: buyer,
      lines: [{ code: 'P-1', name: 'Café', quantity: '1', unitPrice, ivaRateCode: '4' }],
      payments: [{ method: '01', amount: total }],
    };
  };
  const issue = async (buyer: string | null = null): Promise<IssuedDocument> => {
    const actor = await owner();
    const point = (await companySettings(actor, db)).branches[0]!.issuePoints[0]!.id;
    return createInvoice(actor, db, { issuePointId: point, ...content('10', buyer) }, issueDeps);
  };
  const returned = async () => {
    const document = await issue();
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await sendDocument(deps, ref(document));
    return document;
  };
  const authorized = async (buyer: string | null) => {
    const document = await issue(buyer);
    await sendDocument(deps, ref(document));
    await checkAuthorization(deps, ref(document));
    expect((await row(document)).status).toBe('AUTHORIZED');
    return document;
  };
  const sendFailed = async () => {
    const document = await issue();
    mock.queue('reception', { kind: 'transport' });
    await sendDocument(deps, ref(document));
    return document;
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    issueDeps = {
      jobs,
      keyCipher,
      appEnv: 'local',
      providerRuc: null,
      consumerFinalMaxAmount: '50.00',
    };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `co.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Upsilon S.A.',
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
    twinId = org.twinTenantId;
    const client = await createClient(await owner(), db, {
      idType: '05',
      identification: '1710034065',
      name: 'María López',
      emails: ['maria@example.com'],
    });
    clientId = client.id;
  });

  beforeEach(() => {
    at('2026-11-10T15:00:00Z');
    mock = createMockSri({ now: () => clock.now() });
    deps = {
      db,
      sri: createSriClient({ transport: mock.transport }),
      jobs,
      clock,
      logger: testLogger(),
      keyCipher,
    };
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('corrects a returned document as the same row, number and key on its issue day', async () => {
    const document = await returned();
    const corrected = await correctInvoice(
      await owner(),
      db,
      document.id,
      content('20', clientId),
      issueDeps,
    );
    expect(corrected).toMatchObject({
      id: document.id,
      sequential: document.sequential,
      accessKey: document.accessKey,
      total: '23.00',
      status: 'SIGNED',
    });
    const after = await row(document);
    expect(after).toMatchObject({ revision: 2, buyerName: 'María López', clientId });
    await expect(validateXml(after.signedXml!, '01')).resolves.toEqual({ valid: true });
    // Revisions add lines; the first set stays.
    expect((await lines(document)).map((line) => [line.revision, line.unitPrice])).toEqual([
      [1, '10.000000'],
      [2, '20.000000'],
    ]);
    expect(await lastEvent(document)).toMatchObject({
      type: 'CORRECTED',
      fromStatus: 'RETURNED',
      toStatus: 'SIGNED',
      actorUserId: ownerId,
    });
    await sendDocument(deps, ref(document));
    expect((await row(document)).status).toBe('RECEIVED');
  });

  it('re-dates a correction made after the issue day, keeping the old key findable', async () => {
    const document = await issue();
    await sendDocument(deps, ref(document));
    mock.queue('authorization', { kind: 'notAuthorized', code: '46', message: 'RUC no existe' });
    await checkAuthorization(deps, ref(document));
    at('2026-11-12T15:00:00Z');
    const corrected = await correctInvoice(
      await owner(),
      db,
      document.id,
      content('12'),
      issueDeps,
    );
    expect(corrected.sequential).toBe(document.sequential);
    expect(corrected.accessKey.slice(0, 8)).toBe('12112026');
    expect(corrected.issueDate).toBe('2026-11-12');
    const actor = await owner();
    await expect(findByAccessKey(actor, db, document.accessKey)).resolves.toEqual({
      documentId: document.id,
      current: false,
    });
    await expect(findByAccessKey(actor, db, corrected.accessKey)).resolves.toEqual({
      documentId: document.id,
      current: true,
    });
  });

  it('corrects an unsent one only once SRI was asked and didn’t have it, and nothing else', async () => {
    const document = await sendFailed();
    await expect(
      correctInvoice(await owner(), db, document.id, content('11'), issueDeps),
    ).rejects.toMatchObject({ code: 'MAY_BE_AT_SRI' });
    at('2026-11-11T05:00:00Z');
    await checkAfterDeadline(deps, ref(document));
    at('2026-11-11T15:00:00Z');
    await expect(
      correctInvoice(await owner(), db, document.id, content('11'), issueDeps),
    ).resolves.toMatchObject({ status: 'SIGNED', issueDate: '2026-11-11' });

    at('2026-11-10T15:00:00Z');
    const done = await authorized(null);
    await expect(
      correctInvoice(await owner(), db, done.id, content('11'), issueDeps),
    ).rejects.toMatchObject({ code: 'NOT_CORRECTABLE' });
    const viewer: ActorContext = { ...(await owner()), permissions: ['documents.read'] };
    await expect(
      correctInvoice(viewer, db, document.id, content('11'), issueDeps),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('re-issues by hand from D+2 after the date is confirmed, also across a month', async () => {
    at('2026-11-30T15:00:00Z');
    const document = await sendFailed();
    at('2026-12-01T05:00:00Z');
    await checkAfterDeadline(deps, ref(document));
    await expect(
      requestReissue(await owner(), db, document.id, { issueDate: '2026-11-30' }, { jobs }),
    ).rejects.toMatchObject({ code: 'REISSUE_DATE_CHANGED', details: { issueDate: '2026-12-01' } });

    at('2026-12-02T15:00:00Z');
    await requestReissue(await owner(), db, document.id, { issueDate: '2026-12-02' }, { jobs });
    const [job] = (
      await db.withSystem('test: read the re-issue job', ({ executeSql }) =>
        executeSql<{ data: Record<string, unknown> }>(
          `SELECT data FROM pgboss.job WHERE name = 'sri.reissue' AND data->>'documentId' = $1`,
          [document.id],
        ),
      )
    ).rows;
    expect(job!.data).toMatchObject({
      reason: 'MANUAL',
      issueDate: '2026-12-02',
      actorUserId: ownerId,
    });
    await reissueDocument(deps, job!.data as Parameters<typeof reissueDocument>[1]);
    expect(await row(document)).toMatchObject({ status: 'SIGNED', issueDate: '2026-12-02' });
    const [reissue] = await db.withTenant({ tenantId: twinId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.documentReissues)
        .where(
          and(
            eq(schema.documentReissues.documentId, document.id),
            eq(schema.documentReissues.reason, 'MANUAL'),
          ),
        ),
    );
    expect(reissue).toMatchObject({ previousIssueDate: '2026-11-30', actorUserId: ownerId });

    // Today's own document isn't re-issued by hand: it's still being sent.
    const today = await sendFailed();
    await expect(
      requestReissue(await owner(), db, today.id, { issueDate: '2026-12-02' }, { jobs }),
    ).rejects.toMatchObject({ code: 'NOT_REISSUABLE' });
  });

  it('voids only what SRI shows as voided, never consumidor final, with an attestation fallback', async () => {
    const actor = await owner();
    const sri = createSriClient({ transport: mock.transport });
    const document = await authorized(clientId);
    await expect(voidDocument(actor, db, document.id, {}, { sri })).rejects.toMatchObject({
      code: 'NOT_VOIDED_AT_SRI',
      details: { deadline: '2026-12-07' },
    });
    mock.void(document.accessKey);
    await expect(voidDocument(actor, db, document.id, {}, { sri })).resolves.toEqual({
      status: 'VOIDED',
      attested: false,
    });
    expect(await lastEvent(document)).toMatchObject({
      type: 'VOIDED',
      toStatus: 'VOIDED',
      details: { sriStatus: 'VOIDED' },
    });

    const consumer = await authorized(null);
    await expect(voidDocument(actor, db, consumer.id, {}, { sri })).rejects.toMatchObject({
      code: 'VOID_CONSUMER_FINAL',
    });

    const down = await authorized(clientId);
    mock.queue('validity', { kind: 'transport' }, { kind: 'transport' });
    await expect(voidDocument(actor, db, down.id, {}, { sri })).rejects.toMatchObject({
      code: 'SRI_UNAVAILABLE',
      details: { canAttest: true },
    });
    await expect(
      voidDocument(actor, db, down.id, { attestedVoidedAtSri: true }, { sri }),
    ).resolves.toEqual({ status: 'VOIDED', attested: true });
    expect((await lastEvent(down)).details).toMatchObject({ attested: true });
  });

  it('offers each action only when its rule allows it, and lists what is pending', async () => {
    const actor = await owner();
    const returnedOne = await returned();
    expect((await getDocument(actor, db, returnedOne.id)).allowed).toEqual({
      correct: true,
      reissue: false,
      void: false,
      resend: false,
    });
    const done = await authorized(clientId);
    expect((await getDocument(actor, db, done.id)).allowed).toEqual({
      correct: false,
      reissue: false,
      void: true,
      resend: true,
    });
    // Consumidor final: no void, no email to send.
    const consumer = await authorized(null);
    expect((await getDocument(actor, db, consumer.id)).allowed).toMatchObject({
      void: false,
      resend: false,
    });
    const viewer: ActorContext = { ...actor, permissions: ['documents.read'] };
    expect(Object.values((await getDocument(viewer, db, returnedOne.id)).allowed)).toEqual([
      false,
      false,
      false,
      false,
    ]);

    const pending = await listPending(actor, db);
    expect(pending.map((row) => row.id)).toContain(returnedOne.id);
    expect(pending.map((row) => row.id)).not.toContain(done.id);
  });

  it('starts a correction from the document as last signed, without the fields issuing adds', async () => {
    const actor = await owner();
    const point = (await companySettings(actor, db)).branches[0]!.issuePoints[0]!.id;
    const document = await createInvoice(
      actor,
      db,
      {
        issuePointId: point,
        ...content('10', clientId),
        additionalInfo: [{ name: 'Orden', value: 'OC-7' }],
      },
      { ...issueDeps, providerRuc: '1712345678001' },
    );
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await sendDocument(deps, ref(document));
    const draft = await correctionDraft(actor, db, document.id);
    expect(draft).toMatchObject({
      number: document.number,
      clientId,
      lines: [{ code: 'P-1', name: 'Café', quantity: '1.000000', unitPrice: '10.000000' }],
      payments: [{ method: '01', amount: '11.50' }],
      additionalInfo: [{ name: 'Orden', value: 'OC-7' }],
    });
    const done = await authorized(null);
    await expect(correctionDraft(actor, db, done.id)).rejects.toMatchObject({
      code: 'NOT_CORRECTABLE',
    });
  });
});
