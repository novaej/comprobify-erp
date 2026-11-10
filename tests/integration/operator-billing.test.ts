import { randomUUID } from 'node:crypto';
import {
  cardAttemptsToResolve,
  confirmCardPayment,
  createKeyCipher,
  fixedClock,
  invoicingQueue,
  markPaymentInvoiced,
  onboardOrganization,
  refundPayment,
  resolveActor,
  resolveCardAttempt,
  reviewPayment,
  startCardPayment,
  startPaidPlan,
  submitProof,
  type ActorContext,
  type CreatedOrganization,
  type PlatformActor,
} from '@comprobify/core';
import { createFakePayphone, createTestP12, testRuc } from '@comprobify/core/testing';
import { schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, insertTestDocument, superAdmin, testLogger } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const billing = { ivaRate: '15' };

// FR-BILL-4, FR-ADM-2 (ADR-033): the operator's invoices for verified payments, and the card
// charges it settles by hand.
describe("the operator's billing work", () => {
  const clock = fixedClock(new Date().toISOString());
  let db: Database;
  let operator: PlatformActor;
  let company: CreatedOrganization;
  let issuer: CreatedOrganization;
  let ownerId: string;
  let paymentId: string;
  const owner = (): Promise<ActorContext> =>
    resolveActor(db, { userId: ownerId, tenantId: company.twinTenantId, clock });
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
    return 'it did not fail';
  };
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: operator billing', ({ executeSql }) => executeSql(text, values));
  const onboard = async (legalName: string, userId: string) => {
    const ruc = testRuc();
    return onboardOrganization(
      db,
      {
        ownerUserId: userId,
        ruc,
        legalName,
        tradeName: null,
        mainAddress: 'Quito',
        requiredAccounting: false,
        branch: { code: '001', name: 'Matriz', address: 'Quito' },
        issuePointCode: '001',
        certificate: {
          file: createTestP12({
            ruc,
            notBefore: new Date('2026-01-01'),
            notAfter: new Date('2028-12-31'),
          }),
          password: 'secret',
        },
        logo: null,
      },
      { keyCipher: createKeyCipher('d9'.repeat(32)), clock },
    );
  };
  // A factura in the operator's own company, for someone and some amount.
  const invoice = async (buyer: string, total: '11.39' | '9.90', status = 'AUTHORIZED') => {
    const amounts = {
      '11.39': { base: '9.90', iva: '1.49', total: '11.39' },
      '9.90': { base: '8.61', iva: '1.29', total: '9.90' },
    }[total];
    const document = await insertTestDocument(db, issuer.realTenantId, {
      buyerIdentification: buyer,
      amounts,
    });
    await sql(`UPDATE documents SET status = 'PENDING_SEND' WHERE id = $1`, [document.id]);
    await sql(`UPDATE documents SET status = 'RECEIVED' WHERE id = $1`, [document.id]);
    if (status === 'AUTHORIZED')
      await sql(
        `UPDATE documents SET status = 'AUTHORIZED', authorization_number = access_key WHERE id = $1`,
        [document.id],
      );
    return document.accessKey;
  };

  beforeAll(async () => {
    db = appDatabase();
    operator = { ...(await superAdmin(db)), clock };
    const users = await db.identity
      .insert(schema.users)
      .values([
        { name: 'Owner', email: `ob.${randomUUID()}@example.com`, emailVerified: true },
        { name: 'Operator', email: `oc.${randomUUID()}@example.com`, emailVerified: true },
      ])
      .returning({ id: schema.users.id });
    ownerId = users[0]!.id;
    company = await onboard('Chi S.A.', ownerId);
    issuer = await onboard('Operadora S.A.', users[1]!.id);
    const initial = await startPaidPlan(
      await owner(),
      db,
      { planKey: 'STARTER', interval: 'MONTHLY' },
      billing,
    );
    paymentId = initial.id;
    await submitProof(await owner(), db, {
      paymentId,
      reference: 'SPI-1',
      files: [{ filename: 'p.png', content: PNG }],
    });
    await reviewPayment(operator, db, { paymentId, decision: 'VERIFIED' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists a verified payment until its invoice is recorded, and only the right invoice', async () => {
    expect((await invoicingQueue(operator, db)).map((row) => row.id)).toContain(paymentId);
    const ruc = (await sql(`SELECT ruc FROM tenants WHERE id = $1`, [company.realTenantId]))
      .rows[0] as { ruc: string };
    const mark = (accessKey: string) => markPaymentInvoiced(operator, db, { paymentId, accessKey });

    expect(await failure(mark('1'.repeat(49)))).toBe('INVOICE_NOT_FOUND');
    expect(await failure(mark(await invoice(ruc.ruc, '11.39', 'RECEIVED')))).toBe(
      'INVOICE_NOT_AUTHORIZED',
    );
    expect(await failure(mark(await invoice('1790012345001', '11.39')))).toBe(
      'INVOICE_BUYER_MISMATCH',
    );
    expect(await failure(mark(await invoice(ruc.ruc, '9.90')))).toBe('INVOICE_TOTAL_MISMATCH');

    const right = await invoice(ruc.ruc, '11.39');
    await mark(right);
    expect((await invoicingQueue(operator, db)).map((row) => row.id)).not.toContain(paymentId);
    expect(await failure(mark(right))).toBe('PAYMENT_NOT_INVOICEABLE');
    const { rows } = await sql(
      `SELECT action FROM audit_events WHERE tenant_id = $1 AND action = 'payment.invoiced'`,
      [company.realTenantId],
    );
    expect(rows).toHaveLength(1);
  });

  it('leaves a refunded payment out of the queue', async () => {
    await refundPayment(operator, db, { paymentId, reason: 'Pago revertido' });
    expect((await invoicingQueue(operator, db)).map((row) => row.id)).not.toContain(paymentId);
  });

  it('lists a duplicate card charge until the operator settles it', async () => {
    const fake = createFakePayphone();
    const deps = {
      gateway: fake.gateway,
      token: 'test-token-not-a-secret-0002',
      storeId: 'store-1',
      production: false,
      instance: 'ci',
    };
    // The refund put the company back where it was, unbilled, so it starts a plan again.
    const plan = await startPaidPlan(
      await owner(),
      db,
      { planKey: 'STARTER', interval: 'MONTHLY' },
      billing,
    );
    const first = await startCardPayment(await owner(), db, { paymentId: plan.id }, deps);
    const second = await startCardPayment(await owner(), db, { paymentId: plan.id }, deps);
    for (const session of [first, second])
      await confirmCardPayment(
        await owner(),
        db,
        {
          id: fake.pay(session.clientTransactionId, { amount: session.amount }),
          clientTransactionId: session.clientTransactionId,
        },
        deps,
        testLogger(),
      );

    const open = await cardAttemptsToResolve(operator, db);
    const duplicate = open.find((row) => row.paymentCode === plan.code);
    expect(duplicate).toMatchObject({ status: 'DUPLICATE', amountCents: 1139 });
    await expect(
      resolveCardAttempt(operator, db, { attemptId: duplicate!.id, note: 'x' }),
    ).rejects.toThrow();
    await resolveCardAttempt(operator, db, {
      attemptId: duplicate!.id,
      note: 'Reversado en Payphone el mismo día',
    });
    expect((await cardAttemptsToResolve(operator, db)).map((row) => row.id)).not.toContain(
      duplicate!.id,
    );
    expect(
      await failure(
        resolveCardAttempt(operator, db, { attemptId: duplicate!.id, note: 'Otra vez' }),
      ),
    ).toBe('CARD_NOT_TO_RESOLVE');
  });
});
