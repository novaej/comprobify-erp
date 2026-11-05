import { randomUUID } from 'node:crypto';
import {
  checkAfterDeadline,
  companySettings,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createSriClient,
  enqueueReissues,
  fixedClock,
  onboardOrganization,
  reissueDocument,
  resolveActor,
  sendDocument,
  SriTransportError,
  validateXml,
  type IssuedDocument,
  type Jobs,
  type MockSri,
  type ReissueDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { asc, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, testLogger } from './helpers';

// FR-DOC-6, FR-DOC-13; SRI rules 4, 5 and 6. Fixed clocks, the mock SRI.
describe('the next-day re-issue', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('f'.repeat(64));
  let db: Database;
  let jobs: Jobs;
  let mock: MockSri;
  let deps: ReissueDeps;
  let twinId: string;
  let ownerId: string;
  let ruc: string;

  const at = (iso: string) => clock.set(iso);
  const ref = (document: IssuedDocument) => ({ tenantId: twinId, documentId: document.id });
  const row = (document: IssuedDocument) =>
    db.withTenant({ tenantId: twinId }, async ({ db: tx }) => {
      const [found] = await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, document.id));
      return found!;
    });
  const reissues = (document: IssuedDocument) =>
    db.withTenant({ tenantId: twinId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.documentReissues)
        .where(eq(schema.documentReissues.documentId, document.id)),
    );
  // Issued at `when`, then never received that day: SEND_FAILED after the deadline check.
  const failedOn = async (when: string): Promise<IssuedDocument> => {
    at(when);
    const owner = await resolveActor(db, { userId: ownerId, tenantId: twinId, clock });
    const point = (await companySettings(owner, db)).branches[0]!.issuePoints[0]!.id;
    const document = await createInvoice(
      owner,
      db,
      {
        issuePointId: point,
        clientId: null,
        lines: [{ code: 'P-1', name: 'Café', quantity: '1', unitPrice: '10', ivaRateCode: '4' }],
        payments: [{ method: '01', amount: '11.50' }],
      },
      { jobs, keyCipher, appEnv: 'local', providerRuc: null, consumerFinalMaxAmount: '50.00' },
    );
    mock.queue('reception', { kind: 'transport' });
    await sendDocument(deps, ref(document));
    const deadline = (await row(document)).retryUntil!;
    at(new Date(deadline.getTime() + 1).toISOString());
    await checkAfterDeadline(deps, ref(document));
    expect((await row(document)).status).toBe('SEND_FAILED');
    return document;
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `ri.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Tau S.A.',
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
  });

  beforeEach(() => {
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

  it('re-issues on D+1 with today’s date, a new key and the same sequential, then sends it', async () => {
    const document = await failedOn('2026-11-10T15:00:00Z');
    const before = await row(document);
    // 00:30 in Quito on the 11th.
    at('2026-11-11T05:30:00Z');
    await expect(enqueueReissues(deps)).resolves.toBeGreaterThanOrEqual(1);
    await reissueDocument(deps, ref(document));

    const after = await row(document);
    expect(after).toMatchObject({
      status: 'SIGNED',
      issueDate: '2026-11-11',
      sequential: before.sequential,
      series: before.series,
      sendAttempts: 0,
      deadlineCheckedAt: null,
      retryUntil: new Date('2026-11-12T04:59:59.999Z'),
    });
    expect(after.accessKey).not.toBe(before.accessKey);
    expect(after.accessKey.slice(0, 8)).toBe('11112026');
    expect(after.accessKey.slice(30, 39)).toBe(before.accessKey.slice(30, 39));
    expect(after.signedXml).toContain(`<claveAcceso>${after.accessKey}</claveAcceso>`);
    expect(after.signedXml).toContain('<fechaEmision>11/11/2026</fechaEmision>');
    await expect(validateXml(after.signedXml!, '01')).resolves.toEqual({ valid: true });

    // The old key, date and XML stay, so the old key still resolves.
    expect(await reissues(document)).toMatchObject([
      {
        reason: 'AUTO_NEXT_DAY',
        previousAccessKey: before.accessKey,
        previousIssueDate: '2026-11-10',
        previousSignedXml: before.signedXml,
        accessKey: after.accessKey,
        issueDate: '2026-11-11',
      },
    ]);
    const events = await db.withTenant({ tenantId: twinId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.documentEvents)
        .where(eq(schema.documentEvents.documentId, document.id))
        .orderBy(asc(schema.documentEvents.occurredAt), asc(schema.documentEvents.id)),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'REISSUED',
      fromStatus: 'SEND_FAILED',
      toStatus: 'SIGNED',
      details: { reason: 'AUTO_NEXT_DAY', previousAccessKey: before.accessKey },
    });

    // Sent like any new document; a second run finds nothing to do.
    await sendDocument(deps, ref(document));
    expect((await row(document)).status).toBe('RECEIVED');
    await reissueDocument(deps, ref(document));
    expect(await reissues(document)).toHaveLength(1);
  });

  it('re-checks first: a document SRI got after all is not re-issued', async () => {
    const document = await failedOn('2026-11-10T15:00:00Z');
    // It reached SRI, late.
    await deps.sri.send((await row(document)).signedXml!, '1');
    at('2026-11-11T05:30:00Z');
    await reissueDocument(deps, ref(document));
    expect((await row(document)).status).toBe('AUTHORIZED');
    expect(await reissues(document)).toEqual([]);
  });

  it('never crosses a month: the 30th’s document stays for a person', async () => {
    const document = await failedOn('2026-11-30T15:00:00Z');
    at('2026-12-01T05:30:00Z');
    await reissueDocument(deps, ref(document));
    expect(await row(document)).toMatchObject({ status: 'SEND_FAILED', issueDate: '2026-11-30' });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'documents.reissue_skipped_month' }),
    );
  });

  it('leaves D+2 to a person, and retries the job when SRI can’t be asked', async () => {
    const late = await failedOn('2026-11-10T15:00:00Z');
    at('2026-11-12T05:30:00Z');
    await reissueDocument(deps, ref(late));
    expect((await row(late)).issueDate).toBe('2026-11-10');

    const unreachable = await failedOn('2026-11-10T15:00:00Z');
    at('2026-11-11T05:30:00Z');
    mock.queue('authorization', { kind: 'transport' });
    await expect(reissueDocument(deps, ref(unreachable))).rejects.toBeInstanceOf(SriTransportError);
    expect((await row(unreachable)).status).toBe('SEND_FAILED');
    await reissueDocument(deps, ref(unreachable));
    expect((await row(unreachable)).status).toBe('SIGNED');
  });
});
