import { randomUUID } from 'node:crypto';
import {
  alertOverdueAuthorizations,
  checkAfterDeadline,
  checkAuthorization,
  companySettings,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createSriClient,
  fixedClock,
  onboardOrganization,
  resolveActor,
  sendDocument,
  type IssuedDocument,
  type Jobs,
  type MockSri,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { asc, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, testLogger } from './helpers';

// FR-DOC-4, FR-DOC-5, FR-DOC-13; SRI rules 2, 3 and 6. Fixed clocks, the mock SRI.
describe('sending to SRI', () => {
  // 10:00 in Quito on 10 November 2026; the issue day ends at 2026-11-11T04:59:59.999Z.
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('e'.repeat(64));
  let db: Database;
  let jobs: Jobs;
  let mock: MockSri;
  let deps: SendingDeps;
  let twinId: string;
  let ownerId: string;

  const issue = async (): Promise<IssuedDocument> => {
    const owner = await resolveActor(db, { userId: ownerId, tenantId: twinId, clock });
    const point = (await companySettings(owner, db)).branches[0]!.issuePoints[0]!.id;
    return createInvoice(
      owner,
      db,
      {
        issuePointId: point,
        clientId: null,
        lines: [{ code: 'P-1', name: 'Café', quantity: '1', unitPrice: '10', ivaRateCode: '4' }],
        payments: [{ method: '01', amount: '11.50' }],
      },
      {
        jobs,
        keyCipher,
        appEnv: 'local',
        providerRuc: null,
        consumerFinalMaxAmount: '50.00',
      },
    );
  };
  const ref = (document: IssuedDocument) => ({ tenantId: twinId, documentId: document.id });
  const row = (document: IssuedDocument) =>
    db.withTenant({ tenantId: twinId }, async ({ db: tx }) => {
      const [found] = await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, document.id));
      return found!;
    });
  const timeline = (document: IssuedDocument) =>
    db.withTenant({ tenantId: twinId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.documentEvents)
        .where(eq(schema.documentEvents.documentId, document.id))
        .orderBy(asc(schema.documentEvents.occurredAt), asc(schema.documentEvents.id)),
    );
  // The jobs scheduled for later for a document, oldest first; not the one creation enqueues.
  const scheduled = async (document: IssuedDocument, queue: string) =>
    (
      await db.withSystem('test: read scheduled jobs', ({ executeSql }) =>
        executeSql<{ start_after: Date }>(
          `SELECT start_after FROM pgboss.job WHERE name = $1 AND data->>'documentId' = $2 AND start_after > created_on ORDER BY created_on, start_after`,
          [queue, document.id],
        ),
      )
    ).rows.map((job) => job.start_after.toISOString());
  const at = (iso: string) => clock.set(iso);

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `sd.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    const org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
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
      { keyCipher, clock },
    );
    twinId = org.twinTenantId;
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
      random: () => 0,
    };
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('sends, gets RECEIVED, checks authorization and stores what SRI authorized', async () => {
    const document = await issue();
    await sendDocument(deps, ref(document));
    expect(await row(document)).toMatchObject({ status: 'RECEIVED', receivedAt: clock.now() });
    // The first check 15 seconds later.
    expect(await scheduled(document, 'sri.authorize')).toEqual(['2026-11-10T15:00:15.000Z']);

    at('2026-11-10T15:00:15Z');
    await checkAuthorization(deps, ref(document));
    const authorized = await row(document);
    expect(authorized).toMatchObject({
      status: 'AUTHORIZED',
      authorizationNumber: document.accessKey,
      authorizedAt: clock.now(),
    });
    expect(authorized.authorizationXml).toBe(authorized.signedXml);
    expect(
      (await timeline(document)).map((event) => [event.type, event.fromStatus, event.toStatus]),
    ).toEqual([
      ['CREATED', null, 'SIGNED'],
      ['STATUS_CHANGED', 'SIGNED', 'PENDING_SEND'],
      ['STATUS_CHANGED', 'PENDING_SEND', 'RECEIVED'],
      ['STATUS_CHANGED', 'RECEIVED', 'AUTHORIZED'],
    ]);
    expect((await timeline(document))[2]!.sriResponse).toContain('RECIBIDA');

    // Idempotent: a repeated job finds nothing to do.
    await sendDocument(deps, ref(document));
    await checkAuthorization(deps, ref(document));
    expect(await timeline(document)).toHaveLength(4);
  });

  it('counts 70 and 43 as received (SRI rule 3)', async () => {
    const document = await issue();
    // SRI already has it, say from a send whose answer was lost.
    await deps.sri.send((await row(document)).signedXml!, '1');
    await sendDocument(deps, ref(document));
    const received = await row(document);
    expect(received.status).toBe('RECEIVED');
    expect((await timeline(document)).at(-1)!.details).toMatchObject({
      messages: [{ identifier: '70' }],
    });
  });

  it('never retries a clean DEVUELTA, and flags 45 for a person', async () => {
    const returned = await issue();
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await sendDocument(deps, ref(returned));
    expect((await row(returned)).status).toBe('RETURNED');
    expect(await scheduled(returned, 'sri.send')).toEqual([]);

    const taken = await issue();
    mock.queue('reception', { kind: 'returned', code: '45', message: 'SECUENCIAL REGISTRADO' });
    await sendDocument(deps, ref(taken));
    expect((await timeline(taken)).at(-1)!.details).toMatchObject({ sequentialTaken: true });
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'documents.sequential_taken', accessKey: taken.accessKey }),
    );
  });

  it('retries transport errors five times five minutes apart, then hourly, until 23:59', async () => {
    const document = await issue();
    mock.queue('reception', ...Array.from({ length: 7 }, () => ({ kind: 'transport' as const })));
    const times = ['15:00', '15:05', '15:10', '15:15', '15:20'];
    for (const time of times) {
      at(`2026-11-10T${time}:00Z`);
      await sendDocument(deps, ref(document));
    }
    expect(await row(document)).toMatchObject({ status: 'SEND_FAILED', sendAttempts: 5 });
    expect(await scheduled(document, 'sri.send')).toEqual([
      '2026-11-10T15:05:00.000Z',
      '2026-11-10T15:10:00.000Z',
      '2026-11-10T15:15:00.000Z',
      '2026-11-10T15:20:00.000Z',
      // Hourly after the fifth.
      '2026-11-10T16:20:00.000Z',
    ]);

    // 23:30 in Quito: the next hourly try would pass midnight, so the deadline check is set.
    at('2026-11-11T04:30:00Z');
    await sendDocument(deps, ref(document));
    expect(await scheduled(document, 'sri.deadline')).toEqual(['2026-11-11T04:59:59.999Z']);

    // At the deadline SRI doesn't have it: SEND_FAILED, checked, for the next-day re-issue.
    at('2026-11-11T05:00:00Z');
    await checkAfterDeadline(deps, ref(document));
    expect(await row(document)).toMatchObject({
      status: 'SEND_FAILED',
      deadlineCheckedAt: clock.now(),
      sriUnreachable: false,
    });
  });

  it('finds at the deadline what SRI got despite the errors, or flags that SRI could not be asked', async () => {
    const got = await issue();
    mock.queue('reception', { kind: 'transport' });
    await sendDocument(deps, ref(got));
    // The send reached SRI though the answer was lost.
    await deps.sri.send((await row(got)).signedXml!, '1');
    at('2026-11-11T05:00:00Z');
    await checkAfterDeadline(deps, ref(got));
    expect(await row(got)).toMatchObject({
      status: 'AUTHORIZED',
      authorizationNumber: got.accessKey,
    });

    at('2026-11-10T15:00:00Z');
    const unreachable = await issue();
    at('2026-11-11T05:00:00Z');
    mock.queue('authorization', { kind: 'transport' });
    // A send job that runs after the issue day asks first instead of sending.
    await sendDocument(deps, ref(unreachable));
    expect(await row(unreachable)).toMatchObject({ status: 'SEND_FAILED', sriUnreachable: true });
    expect(mock.held.has(unreachable.accessKey)).toBe(false);
  });

  it('asks again while SRI processes: quickly, then hourly, never capped; and stores NO AUTORIZADO', async () => {
    const document = await issue();
    await sendDocument(deps, ref(document));
    mock.queue('authorization', { kind: 'pending' }, { kind: 'transport' });
    at('2026-11-10T15:00:15Z');
    await checkAuthorization(deps, ref(document));
    at('2026-11-10T15:00:45Z');
    await checkAuthorization(deps, ref(document));
    expect(await row(document)).toMatchObject({ status: 'RECEIVED', authorizationChecks: 2 });
    expect(await scheduled(document, 'sri.authorize')).toEqual([
      '2026-11-10T15:00:15.000Z',
      '2026-11-10T15:00:45.000Z',
      '2026-11-10T15:01:45.000Z',
    ]);

    mock.queue('authorization', { kind: 'notAuthorized', code: '46', message: 'RUC no existe' });
    await checkAuthorization(deps, ref(document));
    expect((await row(document)).status).toBe('NOT_AUTHORIZED');
    expect((await timeline(document)).at(-1)!.details).toMatchObject({
      messages: [{ identifier: '46', message: 'RUC no existe' }],
    });
  });

  it('alerts once for a document with no answer 24 hours after RECEIVED (FR-DOC-5)', async () => {
    const document = await issue();
    await sendDocument(deps, ref(document));
    at('2026-11-11T14:59:00Z');
    await alertOverdueAuthorizations(deps);
    expect((await row(document)).overdueAlertedAt).toBeNull();

    at('2026-11-11T15:00:01Z');
    await alertOverdueAuthorizations(deps);
    expect((await row(document)).overdueAlertedAt).toEqual(clock.now());
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'documents.authorization_overdue',
        accessKey: document.accessKey,
      }),
    );
    at('2026-11-12T15:00:00Z');
    await alertOverdueAuthorizations(deps);
    expect((await row(document)).overdueAlertedAt).toEqual(new Date('2026-11-11T15:00:01Z'));
  });
});
