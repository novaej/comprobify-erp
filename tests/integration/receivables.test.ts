import { randomUUID } from 'node:crypto';
import {
  agingReport,
  checkAuthorization,
  companySettings,
  createClient,
  createCreditNote,
  createInvoice,
  createJobs,
  createKeyCipher,
  createMockSri,
  createSriClient,
  fixedClock,
  getReceivable,
  onboardOrganization,
  recordPayment,
  resolveActor,
  sendDocument,
  setIssuePointDocumentType,
  setOverride,
  voidPayment,
  type ActorContext,
  type CreatedOrganization,
  type InvoiceInput,
  type IssueDeps,
  type IssuedDocument,
  type Jobs,
  type MockSri,
  type SendingDeps,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase, appUrl, superAdmin, testLogger } from './helpers';

// FR-SAL-10 (ADR-024): payments recorded by hand, the balance they leave and the aging report.
describe('receivables', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  const keyCipher = createKeyCipher('c6'.repeat(32));
  let db: Database;
  let jobs: Jobs;
  let mock: MockSri;
  let deps: SendingDeps;
  let issueDeps: IssueDeps;
  let org: CreatedOrganization;
  let ownerId: string;
  let maria: string;
  let pedro: string;
  let pointId: string;

  const tenantId = () => org.twinTenantId;
  const owner = (): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: tenantId(), clock });
  const ref = (document: { id: string }) => ({ tenantId: tenantId(), documentId: document.id });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };

  // 10.00 + 15 % IVA = 11.50, with a plazo when asked.
  const invoice = async (
    buyer = maria,
    payments: InvoiceInput['payments'] = [{ method: '01', amount: '11.50' }],
    unitPrice = '10',
  ) =>
    createInvoice(
      await owner(),
      db,
      {
        issuePointId: pointId,
        clientId: buyer,
        lines: [{ code: 'A', name: 'Café', quantity: '1', unitPrice, ivaRateCode: '4' }],
        payments,
      },
      issueDeps,
    );
  const authorized = async (document: IssuedDocument) => {
    await sendDocument(deps, ref(document));
    await checkAuthorization(deps, ref(document));
    return document;
  };
  const owed = async (buyer = maria, payments?: InvoiceInput['payments']) =>
    authorized(await invoice(buyer, payments));
  const view = async (document: { id: string }) => getReceivable(await owner(), db, document.id);

  beforeAll(async () => {
    db = appDatabase();
    jobs = createJobs({ connectionString: appUrl, role: 'web', logger: testLogger() });
    await jobs.start();
    issueDeps = {
      jobs,
      keyCipher,
      appEnv: 'local',
      providerRuc: '1712345678001',
      consumerFinalMaxAmount: '100.00',
    };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `rc.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = user!.id;
    const ruc = testRuc();
    org = await onboardOrganization(
      db,
      {
        ownerUserId: ownerId,
        ruc,
        legalName: 'Omicron S.A.',
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
    const admin = await superAdmin(db);
    for (const featureKey of ['RECEIVABLES', 'DOC_TYPE_04'])
      await setOverride(admin, db, {
        realTenantId: org.realTenantId,
        featureKey,
        effect: 'GRANT',
        limitValue: null,
        reason: 'test',
      });
    const real = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
    await setIssuePointDocumentType(real, db, {
      issuePointId: (await companySettings(real, db)).branches[0]!.issuePoints[0]!.id,
      documentType: '04',
      enabled: true,
    });
    pointId = (await companySettings(await owner(), db)).branches[0]!.issuePoints[0]!.id;
    maria = (
      await createClient(await owner(), db, {
        idType: '05',
        identification: '1710034065',
        name: 'María López',
        emails: ['maria@example.com'],
      })
    ).id;
    pedro = (
      await createClient(await owner(), db, {
        idType: '06',
        identification: 'PA123456',
        name: 'Pedro Paz',
        emails: [],
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

  it('owes an authorized invoice for its total, due on its issue date when it states no term', async () => {
    const document = await owed();
    expect(await view(document)).toMatchObject({
      status: 'UNPAID',
      paid: '0.00',
      balance: '11.50',
      invoice: { total: '11.50', credited: '0.00', issueDate: '2026-11-10', dueDate: '2026-11-10' },
      payments: [],
    });
  });

  it('is due when its longest plazo ends, in days or in months', async () => {
    const days = await owed(maria, [{ method: '01', amount: '11.50', term: 30, termUnit: 'dias' }]);
    expect((await view(days)).invoice.dueDate).toBe('2026-12-10');
    const months = await owed(maria, [
      { method: '01', amount: '5.00', term: 15, termUnit: 'dias' },
      { method: '20', amount: '6.50', term: 2, termUnit: 'meses' },
    ]);
    expect((await view(months)).invoice.dueDate).toBe('2027-01-10');
  });

  it('records partial and full payments, and refuses more than is owed', async () => {
    const document = await owed();
    const actor = await owner();
    const first = await recordPayment(actor, db, {
      documentId: document.id,
      amount: '4.00',
      method: '20',
      reference: '  Transferencia 123  ',
    });
    expect(first).toMatchObject({
      amount: '4.00',
      paidOn: '2026-11-10',
      reference: 'Transferencia 123',
    });
    expect(await view(document)).toMatchObject({
      status: 'PARTIAL',
      paid: '4.00',
      balance: '7.50',
    });
    expect(
      await failure(
        recordPayment(actor, db, { documentId: document.id, amount: '7.51', method: '01' }),
      ),
    ).toBe('PAYMENT_EXCEEDS_BALANCE');
    await recordPayment(actor, db, { documentId: document.id, amount: '7.50', method: '01' });
    expect(await view(document)).toMatchObject({ status: 'PAID', paid: '11.50', balance: '0.00' });
    expect(
      await failure(
        recordPayment(actor, db, { documentId: document.id, amount: '0.01', method: '01' }),
      ),
    ).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  it('dates a payment from the invoice to today, and takes only authorized invoices', async () => {
    const document = await owed();
    const actor = await owner();
    for (const paidOn of ['2026-11-11', '2026-11-09'])
      expect(
        await failure(
          recordPayment(actor, db, { documentId: document.id, amount: '1', method: '01', paidOn }),
        ),
      ).toBe('PAYMENT_DATE_INVALID');
    await recordPayment(actor, db, {
      documentId: document.id,
      amount: '1',
      method: '01',
      paidOn: '2026-11-10',
    });
    const waiting = await invoice();
    expect(
      await failure(
        recordPayment(actor, db, { documentId: waiting.id, amount: '1', method: '01' }),
      ),
    ).toBe('NOT_RECEIVABLE');
    expect(
      await failure(
        recordPayment(actor, db, { documentId: randomUUID(), amount: '1', method: '01' }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('voids a mistaken payment, which gives its amount back to the balance', async () => {
    const document = await owed();
    const actor = await owner();
    const payment = await recordPayment(actor, db, {
      documentId: document.id,
      amount: '11.50',
      method: '01',
    });
    expect((await view(document)).status).toBe('PAID');
    expect(await failure(voidPayment(actor, db, { id: payment.id, reason: '  ' }))).not.toBe(
      'it did not fail',
    );
    const voided = await voidPayment(actor, db, { id: payment.id, reason: 'Cobro duplicado' });
    expect(voided).toMatchObject({ voidReason: 'Cobro duplicado', voidedBy: ownerId });
    expect(await view(document)).toMatchObject({
      status: 'UNPAID',
      paid: '0.00',
      balance: '11.50',
    });
    // It stays on the list, marked, and can't be voided twice.
    expect((await view(document)).payments).toEqual([
      expect.objectContaining({ id: payment.id, voidReason: 'Cobro duplicado' }),
    ]);
    expect(await failure(voidPayment(actor, db, { id: payment.id, reason: 'Otra vez' }))).toBe(
      'PAYMENT_VOIDED',
    );
    // The row can't be rewritten around the function either.
    await expect(
      db.withTenant({ tenantId: tenantId() }, ({ executeSql }) =>
        executeSql(`UPDATE invoice_payments SET amount = 1 WHERE id = $1`, [payment.id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('lets two payments at once take no more than is owed', async () => {
    const document = await owed();
    const actor = await owner();
    const results = await Promise.all(
      [1, 2].map(() =>
        failure(
          recordPayment(actor, db, { documentId: document.id, amount: '11.50', method: '01' }),
        ),
      ),
    );
    expect(results.sort()).toEqual(['PAYMENT_EXCEEDS_BALANCE', 'it did not fail']);
    expect((await view(document)).paid).toBe('11.50');
  });

  it('owes less once a credit note is authorized, and counts only authorized ones', async () => {
    const document = await owed();
    const actor = await owner();
    const note = await createCreditNote(
      actor,
      db,
      {
        issuePointId: pointId,
        originId: document.id,
        reason: 'Devolución',
        lines: [{ sourcePosition: 1, quantity: '1', unitPrice: '4' }],
      },
      issueDeps,
    );
    // Signed, not yet authorized: it doesn't reduce what is owed.
    expect((await view(document)).balance).toBe('11.50');
    await authorized(note);
    // 4.00 + 15 % = 4.60.
    expect(await view(document)).toMatchObject({
      balance: '6.90',
      invoice: { credited: '4.60' },
      status: 'UNPAID',
    });
    await recordPayment(actor, db, { documentId: document.id, amount: '6.90', method: '01' });
    expect((await view(document)).status).toBe('PAID');
    expect(
      await failure(
        recordPayment(actor, db, { documentId: document.id, amount: '0.01', method: '01' }),
      ),
    ).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  it('ages what is owed by days past due, as of today, and drops what is paid', async () => {
    // Due on 2026-12-10 (30 days), 2026-11-10 (the day it is issued) and 2026-11-20.
    const later = await owed(maria, [
      { method: '01', amount: '11.50', term: 30, termUnit: 'dias' },
    ]);
    const now = await owed(pedro);
    clock.set('2026-11-20T15:00:00Z');
    const young = await owed(pedro);
    clock.set('2027-02-20T15:00:00Z');
    const report = await agingReport(await owner(), db);
    // As of 2027-02-20: `later` is 72 days past 2026-12-10, `now` 102, `young` 92.
    const mine = report.rows.filter((row) => [later.id, now.id, young.id].includes(row.id));
    expect(mine.map((row) => [row.number === later.number, row.daysOverdue, row.bucket])).toEqual([
      [false, 102, 'D90_PLUS'],
      [false, 92, 'D90_PLUS'],
      [true, 72, 'D61_90'],
    ]);
    expect(report.asOf).toBe('2027-02-20');
    expect(report.buckets.map((bucket) => bucket.bucket)).toEqual([
      'CURRENT',
      'D1_30',
      'D31_60',
      'D61_90',
      'D90_PLUS',
    ]);
    expect(report.buckets.reduce((sum, bucket) => sum + Number(bucket.balance), 0)).toBeCloseTo(
      Number(report.total),
    );

    // Paying drops it from the report, and the filters narrow the rows, not the sums.
    clock.set('2026-11-20T16:00:00Z');
    await recordPayment(await owner(), db, { documentId: now.id, amount: '11.50', method: '01' });
    clock.set('2027-02-20T15:00:00Z');
    const after = await agingReport(await owner(), db, { bucket: 'D61_90' });
    expect(after.rows.map((row) => row.id)).toContain(later.id);
    expect(after.rows.map((row) => row.id)).not.toContain(now.id);
    expect(after.rows.every((row) => row.bucket === 'D61_90')).toBe(true);
    const byBuyer = await agingReport(await owner(), db, { buyer: 'PA123456' });
    expect(byBuyer.rows.every((row) => row.buyerIdentification === 'PA123456')).toBe(true);
    expect(byBuyer.total).toBe(after.total);
  });

  it('is for the Cuentas por cobrar module and the sales roles', async () => {
    const document = await owed();
    const actor = await owner();
    const viewer = { ...actor, permissions: ['sales.read'] };
    expect((await getReceivable(viewer, db, document.id)).status).toBe('UNPAID');
    expect((await agingReport(viewer, db)).rows.length).toBeGreaterThan(0);
    expect(
      await failure(
        recordPayment(viewer, db, { documentId: document.id, amount: '1', method: '01' }),
      ),
    ).toBe('FORBIDDEN');
    expect(await failure(getReceivable({ ...actor, permissions: [] }, db, document.id))).toBe(
      'FORBIDDEN',
    );
    const without = {
      ...actor,
      entitlements: {
        ...actor.entitlements,
        features: actor.entitlements.features.filter((key) => key !== 'RECEIVABLES'),
      },
    };
    expect(await failure(agingReport(without, db))).toBe('FEATURE_NOT_ENABLED');
    // The real company has none of the twin's invoices.
    const real = await resolveActor(db, { userId: ownerId, tenantId: org.realTenantId, clock });
    expect((await agingReport(real, db)).rows).toEqual([]);
  });
});
