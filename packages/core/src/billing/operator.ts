import { and, asc, eq, inArray, isNull, schema, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { assertSuperAdmin } from '../identity';
import { DomainError, type PlatformActor } from '../kernel';
import { companyRow } from '../tenancy';
import { lockPayment, reviewRowsOf, type ReviewRow } from './payments';

// The operator's billing work in the platform area (FR-ADM-2): the invoices owed for verified
// payments, and the card charges to settle by hand.

// FR-BILL-4: verified and not invoiced yet, oldest first. A refunded one is owed nothing.
export async function invoicingQueue(actor: PlatformActor, db: Database): Promise<ReviewRow[]> {
  await assertSuperAdmin(db.identity, actor);
  return db.withSystem('super admin: the invoicing queue', async ({ db: tx }) => {
    const rows = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.status, 'VERIFIED'), isNull(schema.payments.invoicedAt)))
      .orderBy(asc(schema.payments.verifiedAt))
      .limit(500);
    return reviewRowsOf(tx, rows);
  });
}

// The invoice the operator issued for a payment, already checked by the caller against the
// payment: recorded once, in the caller's system-context transaction.
export async function setPaymentInvoiced(
  tx: Tx['db'],
  input: { paymentId: string; documentId: string; actorUserId: string; now: Date },
): Promise<void> {
  const payment = await lockPayment(tx, input.paymentId);
  if (payment.status !== 'VERIFIED' || payment.invoicedAt)
    throw new DomainError('PAYMENT_NOT_INVOICEABLE', 'Only a verified payment not invoiced yet');
  const [used] = await tx
    .select({ code: schema.payments.code })
    .from(schema.payments)
    .where(eq(schema.payments.invoiceDocumentId, input.documentId));
  if (used)
    throw new DomainError('INVOICE_ALREADY_USED', 'That invoice is already another payment’s', {
      code: used.code,
    });
  await tx
    .update(schema.payments)
    .set({ invoiceDocumentId: input.documentId, invoicedAt: input.now })
    .where(eq(schema.payments.id, payment.id));
  await recordAudit(tx, {
    tenantId: payment.tenantId,
    actorUserId: input.actorUserId,
    action: 'payment.invoiced',
    details: { code: payment.code },
  });
}

// What the invoice must match: the company it bills and the amount paid.
export async function paymentToInvoice(
  tx: Tx['db'],
  paymentId: string,
): Promise<{ ruc: string; totalAmount: string }> {
  const payment = await lockPayment(tx, paymentId);
  const company = await companyRow(tx, payment.tenantId);
  return { ruc: company.ruc, totalAmount: payment.totalAmount };
}

export type CardAttention = {
  id: string;
  status: 'DUPLICATE' | 'ERROR';
  realTenantId: string;
  company: { name: string; ruc: string };
  paymentCode: string;
  clientTransactionId: string;
  payphoneTransactionId: number | null;
  amountCents: number;
  cardBrand: string | null;
  cardLastDigits: string | null;
  confirmedAt: Date | null;
};

// ADR-033: captured charges that weren't applied, to refund by hand in Payphone's dashboard.
export async function cardAttemptsToResolve(
  actor: PlatformActor,
  db: Database,
): Promise<CardAttention[]> {
  await assertSuperAdmin(db.identity, actor);
  return db.withSystem('super admin: card charges to settle', async ({ db: tx }) => {
    const { payphoneTransactions: attempts, payments } = schema;
    const rows = await tx
      .select({ attempt: attempts, code: payments.code })
      .from(attempts)
      .innerJoin(payments, eq(payments.id, attempts.paymentId))
      .where(and(inArray(attempts.status, ['DUPLICATE', 'ERROR']), isNull(attempts.resolvedAt)))
      .orderBy(asc(attempts.confirmedAt));
    const result: CardAttention[] = [];
    for (const { attempt, code } of rows) {
      const company = await companyRow(tx, attempt.tenantId);
      result.push({
        id: attempt.id,
        status: attempt.status as CardAttention['status'],
        realTenantId: attempt.tenantId,
        company: { name: company.name, ruc: company.ruc },
        paymentCode: code,
        clientTransactionId: attempt.clientTransactionId,
        payphoneTransactionId: attempt.payphoneTransactionId,
        amountCents: attempt.amountCents,
        cardBrand: attempt.cardBrand,
        cardLastDigits: attempt.cardLastDigits,
        confirmedAt: attempt.confirmedAt,
      });
    }
    return result;
  });
}

export const resolveCardInput = z.object({
  attemptId: z.uuid(),
  // What was done in Payphone's dashboard: the reversal's reference, or why nothing was owed.
  note: z.string().trim().min(3).max(300),
});

export async function resolveCardAttempt(
  actor: PlatformActor,
  db: Database,
  raw: z.input<typeof resolveCardInput>,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const input = resolveCardInput.parse(raw);
  await db.withSystem('super admin: settle a card charge', async ({ db: tx }) => {
    const { payphoneTransactions: attempts } = schema;
    const [attempt] = await tx
      .select()
      .from(attempts)
      .where(eq(attempts.id, input.attemptId))
      .for('update');
    if (!attempt) throw new DomainError('NOT_FOUND', 'Card attempt not found');
    if (!['DUPLICATE', 'ERROR'].includes(attempt.status) || attempt.resolvedAt)
      throw new DomainError('CARD_NOT_TO_RESOLVE', 'This card charge needs nothing more');
    await tx
      .update(attempts)
      .set({ resolvedAt: actor.clock.now(), resolvedBy: actor.userId, resolutionNote: input.note })
      .where(eq(attempts.id, attempt.id));
    await recordAudit(tx, {
      tenantId: attempt.tenantId,
      actorUserId: actor.userId,
      action: 'payment.card_resolved',
      details: { clientTransactionId: attempt.clientTransactionId, note: input.note },
    });
  });
}
