import { randomUUID } from 'node:crypto';
import {
  checkAuthorization,
  companySettings,
  createClient,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createNoEmailProvider,
  createSriClient,
  documentRide,
  emailDocument,
  fixedClock,
  onboardOrganization,
  resendDocumentEmail,
  resolveActor,
  sendDocument,
  setOverride,
  type CreatedOrganization,
  type EmailMessage,
  type IssuedDocument,
  type Jobs,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-DOC-10, FR-DOC-11; SRI rule 15.
describe('the RIDE and the buyer’s copy', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('b2'.repeat(32));
  const sent: EmailMessage[] = [];
  const provider = {
    send: (message: EmailMessage) => {
      sent.push(message);
      return Promise.resolve('sent' as const);
    },
  };
  let db: Database;
  let jobs: Jobs;
  let deps: SendingDeps;
  let org: CreatedOrganization;
  let ownerId: string;
  let clientId: string;

  const owner = () => resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });
  const ref = (document: IssuedDocument) => ({
    tenantId: org.twinTenantId,
    documentId: document.id,
  });
  const email = (document: IssuedDocument, resend = false) =>
    emailDocument({ db, provider, clock, logger: testLogger() }, { ...ref(document), resend });
  const authorized = async (buyer: string | null) => {
    const actor = await owner();
    const point = (await companySettings(actor, db)).branches[0]!.issuePoints[0]!.id;
    const document = await createInvoice(
      actor,
      db,
      {
        issuePointId: point,
        clientId: buyer,
        lines: [{ code: 'P-1', name: 'Café', quantity: '2', unitPrice: '10', ivaRateCode: '4' }],
        payments: [{ method: '01', amount: '23.00' }],
      },
      { jobs, keyCipher, appEnv: 'local', providerRuc: null, consumerFinalMaxAmount: '50.00' },
    );
    await sendDocument(deps, ref(document));
    await checkAuthorization(deps, ref(document));
    return document;
  };

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    const mock = createMockSri({ now: () => clock.now() });
    deps = {
      db,
      sri: createSriClient({ transport: mock.transport }),
      jobs,
      clock,
      logger: testLogger(),
    };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `be.${randomUUID()}@example.com`, emailVerified: true })
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
    const client = await createClient(await owner(), db, {
      idType: '05',
      identification: '1710034065',
      name: 'María López',
      emails: ['maria@example.com', 'pagos@example.com'],
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('emails the RIDE and the authorized XML once, from the issuer via Comprobify', async () => {
    const document = await authorized(clientId);
    const [job] = (
      await db.withSystem('test: read email jobs', ({ executeSql }) =>
        executeSql<{ data: Record<string, unknown> }>(
          `SELECT data FROM pgboss.job WHERE name = 'documents.email' AND data->>'documentId' = $1`,
          [document.id],
        ),
      )
    ).rows;
    // Enqueued with the authorization.
    expect(job!.data).toEqual({ ...ref(document), resend: false });

    sent.length = 0;
    await email(document);
    expect(sent).toHaveLength(1);
    const [message] = sent;
    expect(message).toMatchObject({
      to: 'maria@example.com,pagos@example.com',
      subject: `[PRUEBAS] Factura ${document.number} de Phi S.A.`,
      fromName: 'Phi S.A. via Comprobify',
      variables: { 'document-id': document.id },
    });
    expect(message!.text).toContain('no tiene validez tributaria');
    const [pdf, xml] = message!.attachments!;
    expect(pdf!.filename).toBe(`RIDE ${document.number}.pdf`);
    expect(pdf!.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(xml!.filename).toBe(`${document.accessKey}.xml`);
    expect(xml!.content.toString()).toContain('<estado>AUTORIZADO</estado>');

    // Once, unless a person resends it.
    await email(document);
    expect(sent).toHaveLength(1);
    await resendDocumentEmail(await owner(), db, document.id, { jobs });
    await email(document, true);
    expect(sent).toHaveLength(2);
    const events = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.documentEvents)
        .where(eq(schema.documentEvents.documentId, document.id)),
    );
    expect(
      events.filter((event) => event.type === 'EMAILED').map((event) => event.details),
    ).toEqual([
      { to: 'maria@example.com,pagos@example.com', resend: false },
      { to: 'maria@example.com,pagos@example.com', resend: true },
    ]);
  });

  it('gives the RIDE only for an authorized document, built from its authorized XML', async () => {
    const document = await authorized(clientId);
    const ride = await documentRide(await owner(), db, document.id);
    expect(ride.filename).toBe(`RIDE ${document.number}.pdf`);
    expect(ride.content.subarray(0, 5).toString()).toBe('%PDF-');

    const actor = await owner();
    const point = (await companySettings(actor, db)).branches[0]!.issuePoints[0]!.id;
    const unsent = await createInvoice(
      actor,
      db,
      {
        issuePointId: point,
        clientId: null,
        lines: [{ code: 'P-1', name: 'Café', quantity: '1', unitPrice: '10', ivaRateCode: '4' }],
        payments: [{ method: '01', amount: '11.50' }],
      },
      { jobs, keyCipher, appEnv: 'local', providerRuc: null, consumerFinalMaxAmount: '50.00' },
    );
    await expect(documentRide(actor, db, unsent.id)).rejects.toMatchObject({
      code: 'NOT_AUTHORIZED',
    });
  });

  it('sends nothing without a buyer email, or without BUYER_EMAIL on the plan', async () => {
    sent.length = 0;
    const consumer = await authorized(null);
    await email(consumer);
    expect(sent).toEqual([]);
    await expect(
      resendDocumentEmail(await owner(), db, consumer.id, { jobs }),
    ).rejects.toMatchObject({
      code: 'NO_BUYER_EMAIL',
    });

    const document = await authorized(clientId);
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'BUYER_EMAIL',
      effect: 'REVOKE',
      limitValue: null,
      reason: 'test',
    });
    await email(document);
    expect(sent).toEqual([]);
    await expect(
      resendDocumentEmail(await owner(), db, document.id, { jobs }),
    ).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENABLED',
    });
  });

  it('writes no EMAILED event when email is off (EMAIL_PROVIDER=none)', async () => {
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'BUYER_EMAIL',
      effect: 'GRANT',
      limitValue: null,
      reason: 'test',
    });
    const document = await authorized(clientId);
    await emailDocument(
      { db, provider: createNoEmailProvider(), clock, logger: testLogger() },
      { ...ref(document), resend: false },
    );
    const events = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx
        .select()
        .from(schema.documentEvents)
        .where(eq(schema.documentEvents.documentId, document.id)),
    );
    expect(events.map((event) => event.type)).not.toContain('EMAILED');
  });
});
