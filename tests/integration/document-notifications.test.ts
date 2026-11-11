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
  deliverNotificationEvent,
  fixedClock,
  onboardOrganization,
  resolveActor,
  sendDocument,
  setNotificationPreference,
  type CreatedOrganization,
  type IssuedDocument,
  type Jobs,
  type MockSri,
  type NotificationEvent,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { and, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, testLogger } from './helpers';

type Sent = { to: string; template: string; params: Record<string, string> };

// FR-NOT-2 (ADR-036): what happens to a document tells the company, through a job queued in the
// transaction that changed it. The jobs are run here by hand, as the worker would.
describe('document notifications', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('e'.repeat(64));
  let db: Database;
  let jobs: Jobs;
  let mock: MockSri;
  let deps: SendingDeps;
  let org: CreatedOrganization;
  let ownerId: string;
  let sent: Sent[] = [];
  const notice = {
    appUrl: 'https://app.test',
    jobs: {
      enqueue: (_tx: unknown, queue: string, data: unknown) => {
        if (queue === 'email.send') sent.push(data as Sent);
        return Promise.resolve(null);
      },
    },
  };

  const issue = async (): Promise<IssuedDocument> => {
    const owner = await resolveActor(db, {
      userId: ownerId,
      tenantId: org.twinTenantId,
      clock,
    });
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
      { jobs, keyCipher, appEnv: 'local', providerRuc: null, consumerFinalMaxAmount: '50.00' },
    );
  };
  const ref = (document: IssuedDocument) => ({
    tenantId: org.twinTenantId,
    documentId: document.id,
  });
  // The events queued for a document, the way the worker would take them.
  const events = async (document: IssuedDocument, type: string) =>
    (
      await db.withSystem('test: read queued events', ({ executeSql }) =>
        executeSql<{ data: NotificationEvent }>(
          `SELECT data FROM pgboss.job WHERE name = 'notifications.send'
           AND data->>'type' = $1 AND data->>'link' = $2 ORDER BY created_on`,
          [type, `/documents/${document.id}`],
        ),
      )
    ).rows.map((job) => job.data);
  const deliver = (event: NotificationEvent) => deliverNotificationEvent({ db, notice }, event);
  const told = (type: string) =>
    db.withSystem('test: read notifications', async ({ db: tx }) =>
      tx
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.tenantId, org.realTenantId),
            eq(schema.notifications.type, type as 'DOCUMENT_REJECTED'),
          ),
        ),
    );
  const receipts = (notificationId: string) =>
    db.withSystem('test: read receipts', ({ db: tx }) =>
      tx
        .select()
        .from(schema.notificationReceipts)
        .where(eq(schema.notificationReceipts.notificationId, notificationId)),
    );

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `dn.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
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
  });

  beforeEach(() => {
    clock.set('2026-11-10T15:00:00Z');
    sent = [];
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

  it('tells the real company when SRI returns a document, once, marked as the test copy', async () => {
    const document = await issue();
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await sendDocument(deps, ref(document));

    const [event] = await events(document, 'DOCUMENT_REJECTED');
    expect(event!.tenantId).toBe(org.twinTenantId);
    expect(event!.params!.number).toMatch(/^001-001-\d{9}$/);
    await deliver(event!);
    const [notification] = (await told('DOCUMENT_REJECTED')).filter(
      (row) => row.link === `/documents/${document.id}`,
    );
    // The real company's, and from its test copy.
    expect(notification).toMatchObject({ tenantId: org.realTenantId, environment: 'TEST' });
    expect(await receipts(notification!.id)).toHaveLength(1);
    expect(sent.map((mail) => mail.template)).toEqual(['documentRejected']);
    expect(sent[0]!.params.number).toBe(event!.params!.number);
    expect(sent[0]!.params.url).toBe(`https://app.test/es/documents/${document.id}`);

    // The job running again tells no one twice.
    await deliver(event!);
    expect(
      (await told('DOCUMENT_REJECTED')).filter((row) => row.link === `/documents/${document.id}`),
    ).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('tells when SRI does not authorize, and when a document never reached SRI', async () => {
    const refused = await issue();
    await sendDocument(deps, ref(refused));
    mock.queue('authorization', {
      kind: 'notAuthorized',
      code: '46',
      message: 'RUC no existe',
    });
    clock.set('2026-11-10T15:00:15Z');
    await checkAuthorization(deps, ref(refused));
    expect(await events(refused, 'DOCUMENT_REJECTED')).toHaveLength(1);

    const unsent = await issue();
    mock.queue('reception', { kind: 'transport' });
    await sendDocument(deps, ref(unsent));
    // A failed try is retried: nothing to say yet.
    expect(await events(unsent, 'DOCUMENT_SEND_FAILED')).toHaveLength(0);
    clock.set('2026-11-11T05:00:00Z');
    await checkAfterDeadline(deps, ref(unsent));
    const [failed] = await events(unsent, 'DOCUMENT_SEND_FAILED');
    expect(failed).toBeDefined();
    await deliver(failed!);
    expect(sent.map((mail) => mail.template)).toEqual(['documentSendFailed']);
  });

  it('tells once when SRI holds a document for 24 hours', async () => {
    const document = await issue();
    await sendDocument(deps, ref(document));
    clock.set('2026-11-11T15:00:01Z');
    await alertOverdueAuthorizations(deps);
    await alertOverdueAuthorizations(deps);
    const queued = await events(document, 'DOCUMENT_OVERDUE');
    expect(queued).toHaveLength(1);
    await deliver(queued[0]!);
    expect(sent.map((mail) => mail.template)).toEqual(['documentOverdue']);
  });

  it('groups authorizations into one notice with a count, for who asked for it', async () => {
    const first = await issue();
    const second = await issue();
    for (const document of [first, second]) {
      await sendDocument(deps, ref(document));
      clock.set('2026-11-10T15:00:15Z');
      await checkAuthorization(deps, ref(document));
    }
    const queued = [
      ...(await events(first, 'DOCUMENTS_AUTHORIZED')),
      ...(await events(second, 'DOCUMENTS_AUTHORIZED')),
    ];
    expect(queued).toHaveLength(2);
    const authorized = () =>
      told('DOCUMENTS_AUTHORIZED').then((rows) => rows.filter((row) => row.environment === 'TEST'));

    // Off until a member switches it on: nothing is written.
    const before = (await authorized()).length;
    await deliver(queued[0]!);
    expect(await authorized()).toHaveLength(before);

    const owner = await resolveActor(db, {
      userId: ownerId,
      tenantId: org.realTenantId,
      clock,
    });
    await setNotificationPreference(owner, db, {
      type: 'DOCUMENTS_AUTHORIZED',
      channel: 'IN_APP',
      enabled: true,
    });
    await deliver(queued[0]!);
    await deliver(queued[1]!);
    const rows = await authorized();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)!.params).toEqual({ count: '2' });
    expect(await receipts(rows.at(-1)!.id)).toHaveLength(1);

    // After the minute, the next one opens a new notice.
    await db.withSystem('test: age the notice', ({ executeSql }) =>
      executeSql(
        `UPDATE notifications SET created_at = now() - interval '2 minutes' WHERE id = $1`,
        [rows.at(-1)!.id],
      ),
    );
    await deliver(queued[1]!);
    const later = await authorized();
    expect(later).toHaveLength(before + 2);
    expect(later.at(-1)!.params).toEqual({ count: '1' });
  });
});
