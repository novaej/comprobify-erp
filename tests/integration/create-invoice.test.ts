import { randomUUID } from 'node:crypto';
import {
  companySettings,
  createClient,
  createInvoice,
  createJobs,
  createKeyCipher,
  fixedClock,
  goLive,
  onboardOrganization,
  resolveActor,
  setClientActive,
  setIssuePointPaused,
  setOverride,
  validateXml,
  type ActorContext,
  type CreatedOrganization,
  type InvoiceInput,
  type IssueDeps,
  type Jobs,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { and, eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-DOC-2, FR-DOC-9, FR-ONB-5, FR-ONB-6a, FR-BILL-7, FR-ROLE-2, SRI rules 5, 6, 8 and 9.
describe('creating an invoice', () => {
  // 10:00 in Quito on 10 November 2026.
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('d'.repeat(64));
  let db: Database;
  let jobs: Jobs;
  let deps: IssueDeps;
  let ownerId: string;
  let org: CreatedOrganization;
  let ruc: string;

  const actor = (tenantId: string) => resolveActor(db, { userId: ownerId, tenantId, clock });
  const pointOf = async (owner: ActorContext) =>
    (await companySettings(owner, db)).branches[0]!.issuePoints[0]!.id;
  const invoice = (issuePointId: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput => ({
    issuePointId,
    clientId: null,
    lines: [{ code: 'P-1', name: 'Café', quantity: '2', unitPrice: '10.005', ivaRateCode: '4' }],
    // 2 × 10.005 = 20.01; IVA 15 % = 3.00.
    payments: [{ method: '01', amount: '23.01' }],
    ...overrides,
  });
  const rowsOf = (tenantId: string, documentId: string) =>
    db.withTenant({ tenantId }, async ({ db: tx }) => ({
      document: (
        await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId))
      )[0]!,
      lines: await tx
        .select()
        .from(schema.documentLines)
        .where(eq(schema.documentLines.documentId, documentId)),
      payments: await tx
        .select()
        .from(schema.documentPayments)
        .where(eq(schema.documentPayments.documentId, documentId)),
      events: await tx
        .select()
        .from(schema.documentEvents)
        .where(eq(schema.documentEvents.documentId, documentId)),
    }));
  const sendJobs = (documentId: string) =>
    db.withSystem('test: read send jobs', ({ executeSql }) =>
      executeSql<{ data: { tenantId: string; documentId: string } }>(
        `SELECT data FROM pgboss.job WHERE name = 'sri.send' AND data->>'documentId' = $1`,
        [documentId],
      ),
    );

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
      .values({ name: 'Owner', email: `ci.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Rho & Hijos S.A.',
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
  });

  afterAll(async () => {
    await jobs.stop();
    await db.close();
  });

  it('signs it, stores it with its lines, payments and event, and enqueues the send', async () => {
    const owner = await actor(org.twinTenantId);
    const client = await createClient(owner, db, {
      idType: '05',
      identification: '1710034065',
      name: 'María López',
      emails: ['maria@example.com', 'pagos@example.com'],
      address: 'Cumbayá',
    });
    const issued = await createInvoice(
      owner,
      db,
      invoice(await pointOf(owner), { clientId: client.id }),
      deps,
    );
    expect(issued).toMatchObject({
      number: '001-001-000000001',
      sequential: 1,
      issueDate: '2026-11-10',
      total: '23.01',
      status: 'SIGNED',
      created: true,
    });
    // ddmmyyyy, type 01, the RUC, ambiente 1, series, sequential (SRI rule 7).
    expect(issued.accessKey.slice(0, 30)).toBe(`10112026` + `01` + ruc + `1` + `001001`);
    expect(issued.accessKey.slice(30, 39)).toBe('000000001');

    const { document, lines, payments, events } = await rowsOf(org.twinTenantId, issued.id);
    expect(document).toMatchObject({
      ambiente: '1',
      buyerName: 'María López',
      buyerEmail: 'maria@example.com,pagos@example.com',
      subtotal: '20.01',
      total: '23.01',
      taxTotals: [{ taxCode: '2', rateCode: '4', percent: '15', base: '20.01', value: '3.00' }],
      createdBy: ownerId,
    });
    expect(lines).toMatchObject([
      { position: 1, base: '20.01', iva: '3.00', quantity: '2.000000' },
    ]);
    expect(payments).toMatchObject([{ method: '01', amount: '23.01' }]);
    expect(events).toMatchObject([{ type: 'CREATED', toStatus: 'SIGNED', actorUserId: ownerId }]);
    await expect(validateXml(document.signedXml!, '01')).resolves.toEqual({ valid: true });
    expect(document.signedXml).toContain('<ds:Signature ');
    expect(document.signedXml).toContain(
      '<campoAdicional nombre="RUC Proveedor">1712345678001</campoAdicional>',
    );
    const job = await sendJobs(issued.id);
    expect(job.rows).toEqual([{ data: { tenantId: org.twinTenantId, documentId: issued.id } }]);
  });

  it('returns the same document for the same key and payload, and refuses another payload', async () => {
    const owner = await actor(org.twinTenantId);
    const point = await pointOf(owner);
    const key = randomUUID();
    const [first, second] = await Promise.all([
      createInvoice(owner, db, invoice(point, { idempotencyKey: key }), deps),
      createInvoice(owner, db, invoice(point, { idempotencyKey: key }), deps),
    ]);
    expect(first.id).toBe(second.id);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    await expect(
      createInvoice(
        owner,
        db,
        invoice(point, {
          idempotencyKey: key,
          lines: [{ code: 'P-2', name: 'Té', quantity: '1', unitPrice: '1', ivaRateCode: '0' }],
          payments: [{ method: '01', amount: '1.00' }],
        }),
        deps,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await sendJobs(first.id)).rows).toHaveLength(1);
  });

  it('refuses what FR-DOC-9 forbids, and a refused one gives its number back', async () => {
    const owner = await actor(org.twinTenantId);
    const point = await pointOf(owner);
    const big = {
      lines: [{ code: 'P-1', name: 'TV', quantity: '1', unitPrice: '100', ivaRateCode: '4' }],
      payments: [{ method: '01', amount: '115.00' }],
    } satisfies Partial<InvoiceInput>;
    await expect(createInvoice(owner, db, invoice(point, big), deps)).rejects.toMatchObject({
      code: 'CONSUMER_FINAL_LIMIT',
    });
    await expect(
      createInvoice(
        owner,
        db,
        invoice(point, { payments: [{ method: '01', amount: '20.00' }] }),
        deps,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENTS_TOTAL_MISMATCH' });
    await expect(
      createInvoice(
        owner,
        db,
        invoice(point, {
          lines: [
            {
              code: 'P',
              name: 'X',
              quantity: '1',
              unitPrice: '1',
              discount: '2',
              ivaRateCode: '0',
            },
          ],
        }),
        deps,
      ),
    ).rejects.toMatchObject({ code: 'LINE_DISCOUNT_TOO_LARGE' });
    await expect(
      createInvoice(
        owner,
        db,
        invoice(point, {
          lines: [
            { code: 'P', name: 'dos\nlíneas', quantity: '1', unitPrice: '1', ivaRateCode: '0' },
          ],
        }),
        deps,
      ),
    ).rejects.toMatchObject({ name: 'ZodError' });

    const before = await createInvoice(owner, db, invoice(point), deps);
    await expect(createInvoice(owner, db, invoice(point, big), deps)).rejects.toThrow();
    const after = await createInvoice(owner, db, invoice(point), deps);
    expect(after.sequential).toBe(before.sequential + 1);
  });

  it('needs the permission, an allowed and running issue point, and an active client', async () => {
    const owner = await actor(org.twinTenantId);
    const point = await pointOf(owner);
    await expect(
      createInvoice({ ...owner, permissions: ['documents.read'] }, db, invoice(point), deps),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createInvoice({ ...owner, issuePointIds: [randomUUID()] }, db, invoice(point), deps),
    ).rejects.toMatchObject({ code: 'ISSUE_POINT_NOT_ALLOWED' });

    const client = await createClient(owner, db, {
      idType: '05',
      identification: '0102030400',
      name: 'Inactivo',
      emails: [],
    });
    await setClientActive(owner, db, { id: client.id, active: false });
    await expect(
      createInvoice(owner, db, invoice(point, { clientId: client.id }), deps),
    ).rejects.toMatchObject({ code: 'CLIENT_INACTIVE' });

    await setIssuePointPaused(owner, db, { issuePointId: point, canIssue: false });
    await expect(createInvoice(owner, db, invoice(point), deps)).rejects.toMatchObject({
      code: 'ISSUE_POINT_PAUSED',
    });
    await setIssuePointPaused(owner, db, { issuePointId: point, canIssue: true });
  });

  it('issues in the real company only once live, with its own numbers and quota; never the twin’s', async () => {
    const real = await actor(org.realTenantId);
    const point = await pointOf(real);
    await expect(createInvoice(real, db, invoice(point), deps)).rejects.toMatchObject({
      code: 'NOT_LIVE',
    });
    await goLive(real, db, { requireAgreements: false });
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
      effect: 'LIMIT',
      limitValue: 1,
      reason: 'test',
    });

    const live = await actor(org.realTenantId);
    // Still SRI test outside the production deployment (FR-ONB-6).
    const first = await createInvoice(live, db, invoice(point), deps);
    expect(first).toMatchObject({ sequential: 1 });
    expect(first.accessKey[23]).toBe('1');
    await expect(createInvoice(live, db, invoice(point), deps)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });

    // The twin carries the same limit and never uses it.
    const twin = await actor(org.twinTenantId);
    const twinPoint = await pointOf(twin);
    for (let i = 0; i < 2; i++) await createInvoice(twin, db, invoice(twinPoint), deps);

    // On the production deployment, the live company issues in ambiente 2.
    await setOverride(await superAdmin(db), db, {
      realTenantId: org.realTenantId,
      featureKey: 'DOCUMENT_QUOTA',
      effect: 'LIMIT',
      limitValue: null,
      reason: 'test',
    });
    const production = await createInvoice(await actor(org.realTenantId), db, invoice(point), {
      ...deps,
      appEnv: 'production',
    });
    expect(production.accessKey[23]).toBe('2');
    const [row] = await db.withTenant({ tenantId: org.realTenantId }, ({ db: tx }) =>
      tx
        .select({ ambiente: schema.documents.ambiente })
        .from(schema.documents)
        .where(and(eq(schema.documents.id, production.id))),
    );
    expect(row!.ambiente).toBe('2');
  });

  it('saves edits to the client with the invoice, and neither without the permission', async () => {
    const owner = await actor(org.twinTenantId);
    const point = await pointOf(owner);
    const client = await createClient(owner, db, {
      idType: '05',
      identification: '0912345675',
      name: 'Pedro Ruiz',
      emails: ['pedro@example.com'],
    });
    const changes = {
      name: 'Pedro Ruiz Vera',
      emails: ['pedro@example.com', 'compras@example.com'],
      phone: '0991234567',
      address: 'Guayaquil',
    };
    const issued = await createInvoice(
      owner,
      db,
      invoice(point, { clientId: client.id, clientChanges: changes }),
      deps,
    );
    const { document } = await rowsOf(org.twinTenantId, issued.id);
    expect(document).toMatchObject({
      buyerName: 'Pedro Ruiz Vera',
      buyerAddress: 'Guayaquil',
      buyerEmail: 'pedro@example.com,compras@example.com',
    });
    const [saved] = await db.withTenant({ tenantId: org.twinTenantId }, ({ db: tx }) =>
      tx.select().from(schema.clients).where(eq(schema.clients.id, client.id)),
    );
    expect(saved).toMatchObject(changes);

    // A seller who can't manage clients: refused, and nothing is issued.
    const seller = { ...owner, permissions: ['documents.issue', 'clients.read'] };
    const before = (await rowsOf(org.twinTenantId, issued.id)).document.sequential;
    await expect(
      createInvoice(
        seller,
        db,
        invoice(point, { clientId: client.id, clientChanges: { ...changes, name: 'Otro' } }),
        deps,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const next = await createInvoice(owner, db, invoice(point), deps);
    expect(next.sequential).toBe(before + 1);
  });
});
