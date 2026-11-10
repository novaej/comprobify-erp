import { randomUUID } from 'node:crypto';
import {
  applyDueRenewal,
  addModule,
  cancelPayment,
  createKeyCipher,
  fixedClock,
  getPayment,
  listPayments,
  onboardOrganization,
  openRenewal,
  paymentForReview,
  paymentsToReview,
  planOverview,
  proofFile,
  proofFileForReview,
  refundPayment,
  removeProof,
  resolveActor,
  reviewPayment,
  setBilling,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin, testNotice } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.4 proof');

// FR-BILL-2, FR-BILL-3, FR-BILL-4, FR-BILL-8 (ADR-029): paying for a plan by transfer.
describe('payments', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let org: CreatedOrganization;
  let ownerId: string;

  const owner = (): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: org.twinTenantId, clock });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string; name?: string }).code ?? (error as Error).name;
    }
    return 'it did not fail';
  };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: payments', ({ executeSql }) => executeSql(text, values));
  const subscriptionOf = async (tenantId: string) =>
    (
      await sql(
        `SELECT p.key AS plan, s.interval, s.status, s.period_start::text AS start,
                s.period_end::text AS "end"
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`,
        [tenantId],
      )
    ).rows[0];
  const report = async (paymentId: string, files = [{ filename: 'pago.png', content: PNG }]) =>
    submitProof(await owner(), db, { paymentId, reference: 'SPI-123456', files });

  beforeAll(async () => {
    db = appDatabase();
    operator = { ...(await superAdmin(db)), clock };
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Owner', email: `pay.${randomUUID()}@example.com`, emailVerified: true })
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
      { keyCipher: createKeyCipher('d3'.repeat(32)), clock },
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the database to the rules', async () => {
    const { rows } = await sql(
      `SELECT prosrc FROM pg_proc WHERE proname = 'app_payment_status_check'`,
    );
    expect((rows[0] as { prosrc: string }).prosrc).toContain(schema.paymentStatusTriggerBody());
  });

  it('prices a paid plan with its add-ons and IVA, in the real company, one at a time', async () => {
    expect(
      await failure(startPaidPlan(await owner(), db, { planKey: 'FREE', interval: 'MONTHLY' })),
    ).toBe('PLAN_NOT_SOLD');
    expect(
      await failure(startPaidPlan(await owner(), db, { planKey: 'CUSTOM', interval: 'MONTHLY' })),
    ).toBe('PLAN_NOT_SOLD');
    await addModule(operator, db, { realTenantId: org.realTenantId, moduleKey: 'DELIVERY_GUIDES' });
    // From the twin, where the owner works: the payment belongs to the real company.
    const payment = await startPaidPlan(await owner(), db, {
      planKey: 'BUSINESS',
      interval: 'MONTHLY',
    });
    // Negocio 29.90 + Guías 5.00 = 34.90; 15 % IVA is 5.235, so 5.24.
    expect(payment).toMatchObject({
      purpose: 'INITIAL',
      status: 'PENDING',
      baseAmount: '34.90',
      ivaRate: '15.00',
      ivaAmount: '5.24',
      totalAmount: '40.14',
      targetPlan: { key: 'BUSINESS' },
      targetInterval: 'MONTHLY',
    });
    expect(payment.code).toMatch(/^CB-[2-9A-HJ-NP-Z]{8}$/);
    const { rows } = await sql(`SELECT tenant_id FROM payments WHERE id = $1`, [payment.id]);
    expect(rows[0]).toEqual({ tenant_id: org.realTenantId });
    expect(
      await failure(startPaidPlan(await owner(), db, { planKey: 'STARTER', interval: 'YEARLY' })),
    ).toBe('PAYMENT_IN_PROGRESS');
    // Nothing changed yet: access waits for the payment.
    expect(await subscriptionOf(org.realTenantId)).toMatchObject({ plan: 'FREE', end: null });
    await cancelPayment(await owner(), db, payment.id);
    // Yearly is ten months: (29.90 + 5.00) × 10.
    const yearly = await startPaidPlan(await owner(), db, {
      planKey: 'BUSINESS',
      interval: 'YEARLY',
    });
    expect(yearly).toMatchObject({ baseAmount: '349.00', totalAmount: '401.35' });
    await cancelPayment(await owner(), db, yearly.id);
  });

  it('takes proof of a transfer, which the company can withdraw and the operator still sees', async () => {
    const payment = await startPaidPlan(await owner(), db, {
      planKey: 'BUSINESS',
      interval: 'MONTHLY',
    });
    expect(
      await failure(report(payment.id, [{ filename: 'x.txt', content: Buffer.from('hello') }])),
    ).toBe('PROOF_INVALID');
    expect(
      await failure(
        report(
          payment.id,
          Array.from({ length: 6 }, () => ({ filename: 'p.png', content: PNG })),
        ),
      ),
    ).toBe('ZodError');
    await report(payment.id, [
      { filename: 'pago.png', content: PNG },
      { filename: 'recibo.pdf', content: PDF },
    ]);
    let view = await getPayment(await owner(), db, payment.id);
    expect(view).toMatchObject({ status: 'REPORTED', method: 'SPI_TRANSFER' });
    expect(view.proofs.map((proof) => proof.contentType)).toEqual(['image/png', 'application/pdf']);
    expect(
      (await proofFile(await owner(), db, { paymentId: payment.id, proofId: view.proofs[1]!.id }))
        .content,
    ).toEqual(PDF);
    await removeProof(await owner(), db, { paymentId: payment.id, proofId: view.proofs[0]!.id });
    view = await getPayment(await owner(), db, payment.id);
    expect(view.proofs).toHaveLength(1);
    const review = await paymentForReview(operator, db, payment.id);
    expect(review.proofList.map((proof) => proof.active)).toEqual([false, true]);
    expect(
      (
        await proofFileForReview(operator, db, {
          paymentId: payment.id,
          proofId: review.proofList[0]!.id,
        })
      ).content,
    ).toEqual(PNG);
    // The file itself never changes.
    await expect(
      db.withTenant({ tenantId: org.realTenantId }, ({ executeSql }) =>
        executeSql(`UPDATE payment_proofs SET content = 'x' WHERE payment_id = $1`, [payment.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    // The operator's queue lists it, with the company.
    const queue = await paymentsToReview(operator, db);
    expect(queue.find((row) => row.id === payment.id)).toMatchObject({
      realTenantId: org.realTenantId,
      proofs: 2,
    });
  });

  it('rejects with a reason, takes the proof again, and verifying grants the plan at once', async () => {
    const [payment] = (await listPayments(await owner(), db)).filter(
      (row) => row.status === 'REPORTED',
    );
    await reviewPayment(
      operator,
      db,
      {
        paymentId: payment!.id,
        decision: 'REJECTED',
        reason: 'AMOUNT_MISMATCH',
      },
      testNotice,
    );
    expect(await getPayment(await owner(), db, payment!.id)).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'AMOUNT_MISMATCH',
    });
    await report(payment!.id);
    await reviewPayment(operator, db, { paymentId: payment!.id, decision: 'VERIFIED' }, testNotice);
    // The first period starts the day it is paid, for the company and its twin.
    for (const tenantId of [org.realTenantId, org.twinTenantId])
      expect(await subscriptionOf(tenantId)).toEqual({
        plan: 'BUSINESS',
        interval: 'MONTHLY',
        status: 'ACTIVE',
        start: '2026-11-10',
        end: '2026-12-10',
      });
    expect((await owner()).entitlements.limits.DOCUMENT_QUOTA).toBe(300);
    expect((await planOverview(await owner(), db)).plan.key).toBe('BUSINESS');
    expect(await getPayment(await owner(), db, payment!.id)).toMatchObject({
      status: 'VERIFIED',
      periodStart: '2026-11-10',
      periodEnd: '2026-12-10',
    });
    // Settled once: verifying again would extend a period twice.
    expect(
      await failure(
        reviewPayment(operator, db, { paymentId: payment!.id, decision: 'VERIFIED' }, testNotice),
      ),
    ).toBe('PAYMENT_NOT_REVIEWABLE');
  });

  it('renews from the old end even when paid early, then refunds latest first back to the snapshot', async () => {
    const renewal = await db.withSystem('test: open a renewal', ({ db: tx }) =>
      openRenewal(tx, org.realTenantId, clock.now()),
    );
    expect(renewal).toMatchObject({ purpose: 'RENEWAL', baseAmount: '34.90' });
    expect(
      await db.withSystem('test: open it again', ({ db: tx }) =>
        openRenewal(tx, org.realTenantId, clock.now()),
      ),
    ).toBeNull();
    expect(await failure(cancelPayment(await owner(), db, renewal!.id))).toBe(
      'PAYMENT_NOT_CANCELLABLE',
    );
    await report(renewal!.id);
    await reviewPayment(operator, db, { paymentId: renewal!.id, decision: 'VERIFIED' }, testNotice);
    // Paid ahead: the company keeps its period until the next one starts (ADR-035).
    expect(await subscriptionOf(org.realTenantId)).toMatchObject({
      start: '2026-11-10',
      end: '2026-12-10',
    });
    const roll = (iso: string) =>
      db.withSystem('test: the day the period starts', ({ db: tx }) =>
        applyDueRenewal(tx, org.realTenantId, new Date(iso)),
      );
    await expect(roll('2026-12-09T15:00:00Z')).resolves.toBe(false);
    await expect(roll('2026-12-10T11:00:00Z')).resolves.toBe(true);
    expect(await subscriptionOf(org.realTenantId)).toMatchObject({
      start: '2026-12-10',
      end: '2027-01-10',
    });
    await expect(roll('2026-12-10T12:00:00Z')).resolves.toBe(false);

    const [initial] = (await listPayments(await owner(), db)).filter(
      (row) => row.purpose === 'INITIAL' && row.status === 'VERIFIED',
    );
    expect(
      await failure(refundPayment(operator, db, { paymentId: initial!.id, reason: 'Reversed' })),
    ).toBe('PAYMENT_NOT_REFUNDABLE');
    await refundPayment(operator, db, { paymentId: renewal!.id, reason: 'Duplicate transfer' });
    expect(await subscriptionOf(org.realTenantId)).toMatchObject({
      plan: 'BUSINESS',
      start: '2026-11-10',
      end: '2026-12-10',
    });
    await refundPayment(operator, db, { paymentId: initial!.id, reason: 'Transfer reversed' });
    for (const tenantId of [org.realTenantId, org.twinTenantId])
      expect(await subscriptionOf(tenantId)).toEqual({
        plan: 'FREE',
        interval: 'MONTHLY',
        status: 'ACTIVE',
        start: '2026-11-10',
        end: null,
      });
    expect((await getPayment(await owner(), db, initial!.id)).status).toBe('REFUNDED');
  });

  it('needs the role, and never charges a complimentary company', async () => {
    const viewer = { ...(await owner()), permissions: ['billing.read'] };
    expect(
      await failure(startPaidPlan(viewer, db, { planKey: 'BUSINESS', interval: 'MONTHLY' })),
    ).toBe('FORBIDDEN');
    expect(await failure(paymentsToReview({ ...operator, userId: ownerId }, db))).toBe('FORBIDDEN');
    await setBilling(operator, db, {
      realTenantId: org.realTenantId,
      complimentary: true,
      reason: 'Owner company',
    });
    expect(
      await failure(startPaidPlan(await owner(), db, { planKey: 'BUSINESS', interval: 'MONTHLY' })),
    ).toBe('SUBSCRIPTION_COMPLIMENTARY');
  });
});
