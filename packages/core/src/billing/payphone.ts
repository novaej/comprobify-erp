import { randomBytes } from 'node:crypto';
import type { Logger } from '@comprobify/config/logger';
import {
  and,
  eq,
  isNull,
  lt,
  schema,
  sql,
  type CardAttemptStatus,
  type Database,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { notify, type NotifyDeps } from '../notifications';
import {
  DomainError,
  ecuadorDate,
  requirePermission,
  type ActorContext,
  type Clock,
} from '../kernel';
import { applyVerifiedPayment, inCompany, lockPayment } from './payments';
import { PAYPHONE_APPROVED, type ConfirmBody, type PayphoneGateway } from './payphone-gateway';

// FR-BILL-3 (ADR-033): a company pays one of its own payments by card through Payphone's widget.
// The amount always comes from the payment, never from the request. Every guard here came from a
// real incident in the previous system.

// Payphone refuses a charge under $1.00 (its error 107): a prorated change can come to less.
export const CARD_MIN_CENTS = 100;
// Attempts are never reused, so a page that opens the widget in a loop is bounded here.
export const CARD_MAX_PENDING_ATTEMPTS = 10;
// Payphone reverses at 5 minutes, so by 10 an attempt's outcome is settled either way.
export const CARD_STALE_MINUTES = 10;
const MAX_REFERENCE = 100;

// What the deployment gives: null when Payphone isn't set up, and card payments are refused
// while transfers carry on.
export type PayphoneDeps = {
  gateway: PayphoneGateway;
  token: string;
  storeId: string;
  // Outside production the payer's receipt names the machine, to tell environments apart in
  // Payphone's console. Never in production: a customer reads it.
  production: boolean;
  instance: string;
} | null;

type AttemptRow = typeof schema.payphoneTransactions.$inferSelect;
type PaymentRow = typeof schema.payments.$inferSelect;

function requireConfigured(deps: PayphoneDeps): NonNullable<PayphoneDeps> {
  if (!deps)
    throw new DomainError(
      'CARD_NOT_AVAILABLE',
      'Card payments are not set up here; pay by transfer',
    );
  return deps;
}

// Payphone requires amount = amountWithoutTax + amountWithTax + tax + service + tip, in cents.
// The taxed part is derived, so rounding both halves can never break the sum by a cent.
export function cardAmounts(payment: Pick<PaymentRow, 'totalAmount' | 'ivaAmount'>) {
  const cents = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  };
  const amount = cents(payment.totalAmount);
  const tax = cents(payment.ivaAmount);
  return { amount, tax, amountWithTax: amount - tax, amountWithoutTax: 0, service: 0, tip: 0 };
}

export type CardSession = ReturnType<typeof cardAmounts> & {
  attemptId: string;
  clientTransactionId: string;
  token: string;
  storeId: string;
  currency: 'USD';
  reference: string;
};

export const cardPaymentInput = z.object({ paymentId: z.uuid() });

// The widget's configuration for one new attempt.
export async function startCardPayment(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof cardPaymentInput>,
  deps: PayphoneDeps,
): Promise<CardSession> {
  requirePermission(ctx, 'billing.manage');
  const payphone = requireConfigured(deps);
  const input = cardPaymentInput.parse(raw);
  return inCompany(ctx, db, async ({ db: tx }, tenantId) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.id, input.paymentId)))
      .for('update');
    if (!payment) throw new DomainError('NOT_FOUND', 'Payment not found');
    // A proof is waiting for the operator: a card charge now could pay it twice.
    if (payment.status === 'REPORTED')
      throw new DomainError('PAYMENT_IN_REVIEW', 'A transfer for this payment is being reviewed');
    if (payment.status !== 'PENDING' && payment.status !== 'REJECTED')
      throw new DomainError('PAYMENT_NOT_PAYABLE', 'This payment is settled', {
        status: payment.status,
      });
    const amounts = cardAmounts(payment);
    if (amounts.amount < CARD_MIN_CENTS)
      throw new DomainError('CARD_AMOUNT_TOO_LOW', 'Card payments start at $1.00; pay by transfer');
    const [pending] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.payphoneTransactions)
      .where(
        and(
          eq(schema.payphoneTransactions.paymentId, payment.id),
          eq(schema.payphoneTransactions.status, 'PENDING'),
        ),
      );
    if (pending!.n >= CARD_MAX_PENDING_ATTEMPTS)
      throw new DomainError('CARD_TOO_MANY_ATTEMPTS', 'Wait for the open card attempts to settle');
    // 16 hex characters, under Payphone's 50; never the payment's id, so each attempt differs.
    const clientTransactionId = randomBytes(8).toString('hex');
    const [attempt] = await tx
      .insert(schema.payphoneTransactions)
      .values({
        tenantId,
        paymentId: payment.id,
        clientTransactionId,
        amountCents: amounts.amount,
        createdBy: ctx.userId ?? null,
      })
      .returning({ id: schema.payphoneTransactions.id });
    const base = `Comprobify ${payment.code}`;
    return {
      attemptId: attempt!.id,
      clientTransactionId,
      token: payphone.token,
      storeId: payphone.storeId,
      currency: 'USD',
      reference: (payphone.production ? base : `${base} · ${payphone.instance}`).slice(
        0,
        MAX_REFERENCE,
      ),
      ...amounts,
    };
  });
}

const outcomeColumns = (body: ConfirmBody, now: Date) => ({
  statusCode: typeof body.statusCode === 'number' ? body.statusCode : null,
  authorizationCode: typeof body.authorizationCode === 'string' ? body.authorizationCode : null,
  cardBrand: typeof body.cardBrand === 'string' ? body.cardBrand : null,
  cardLastDigits: typeof body.lastDigits === 'string' ? body.lastDigits : null,
  confirmResponse: body,
  confirmedAt: now,
});

const setAttempt = (tx: Tx['db'], id: string, values: Partial<AttemptRow>) =>
  tx.update(schema.payphoneTransactions).set(values).where(eq(schema.payphoneTransactions.id, id));

// Real money that must not be applied: recorded where the operator looks, to refund by hand in
// Payphone's dashboard. Never through refundPayment: the subscription is rightly paid.
async function flagDuplicate(
  tx: Tx['db'],
  attempt: AttemptRow,
  payment: PaymentRow,
  logger: Logger,
): Promise<'DUPLICATE'> {
  await setAttempt(tx, attempt.id, { status: 'DUPLICATE' });
  await recordAudit(tx, {
    tenantId: attempt.tenantId,
    actorUserId: null,
    action: 'payment.card_duplicate',
    details: {
      code: payment.code,
      clientTransactionId: attempt.clientTransactionId,
      payphoneTransactionId: String(attempt.payphoneTransactionId ?? ''),
      amountCents: attempt.amountCents,
    },
  });
  logger.error(
    `Duplicate Payphone charge ${attempt.payphoneTransactionId ?? ''} on payment ${payment.code}: refund it by hand`,
    { event: 'payphone.duplicate', tenantId: attempt.tenantId },
  );
  return 'DUPLICATE';
}

// What a Payphone answer makes of a pending attempt, inside the transaction holding its lock.
async function settle(
  tx: Tx['db'],
  attempt: AttemptRow,
  result: Extract<Awaited<ReturnType<PayphoneGateway['confirm']>>, { reached: true }>,
  now: Date,
  logger: Logger,
  // Past Payphone's window, a charge not approved has been reversed.
  notApproved: 'CANCELLED' | 'EXPIRED' = 'CANCELLED',
): Promise<CardAttemptStatus> {
  const body = result.body ?? {};
  const columns = {
    ...outcomeColumns(body, now),
    payphoneTransactionId:
      typeof body.transactionId === 'number' ? body.transactionId : attempt.payphoneTransactionId,
  };
  if (body.statusCode !== PAYPHONE_APPROVED) {
    // Not a rejection of the payment: the company opens a new attempt.
    await setAttempt(tx, attempt.id, { ...columns, status: notApproved });
    return notApproved;
  }
  // Never trust the amount Payphone echoes: a different one is never applied.
  if (body.amount !== attempt.amountCents) {
    await setAttempt(tx, attempt.id, { ...columns, status: 'ERROR' });
    logger.error(
      `Payphone confirmed ${String(body.amount)} cents for an attempt of ${attempt.amountCents}`,
      { event: 'payphone.amount_mismatch', tenantId: attempt.tenantId },
    );
    return 'ERROR';
  }
  await setAttempt(tx, attempt.id, { ...columns, status: 'APPROVED' });
  return 'APPROVED';
}

export const confirmCardInput = z.object({
  // Payphone's transaction id and ours, from the return page's query string.
  id: z.coerce.number().int().positive(),
  clientTransactionId: z.string().regex(/^[0-9a-f]{16}$/),
});
export type ConfirmCardInput = z.input<typeof confirmCardInput>;

export type CardOutcome = {
  // PENDING: Payphone couldn't be reached; the sweep finishes it.
  status: CardAttemptStatus;
  paymentId: string;
};

// The return page, as soon as it loads: Payphone reverses what isn't confirmed in 5 minutes.
// Phase one asks Payphone and commits its answer; phase two applies the payment. A crash between
// them leaves APPROVED with no applied_at, which the sweep finishes.
export async function confirmCardPayment(
  ctx: ActorContext,
  db: Database,
  raw: ConfirmCardInput,
  deps: PayphoneDeps,
  logger: Logger,
  notice: NotifyDeps,
): Promise<CardOutcome> {
  requirePermission(ctx, 'billing.manage');
  const payphone = requireConfigured(deps);
  const input = confirmCardInput.parse(raw);
  const now = ctx.clock.now();
  let attemptId: string | null = null;
  let outcome: CardOutcome;
  try {
    outcome = await inCompany(ctx, db, async ({ db: tx }, tenantId) => {
      // Held across the call: a second load of the return page waits, then reads the answer.
      const [attempt] = await tx
        .select()
        .from(schema.payphoneTransactions)
        .where(
          and(
            eq(schema.payphoneTransactions.tenantId, tenantId),
            eq(schema.payphoneTransactions.clientTransactionId, input.clientTransactionId),
          ),
        )
        .for('update');
      if (!attempt) throw new DomainError('NOT_FOUND', 'Card attempt not found');
      attemptId = attempt.id;
      if (attempt.status !== 'PENDING')
        return { status: attempt.status, paymentId: attempt.paymentId };
      const result = await payphone.gateway.confirm({
        id: input.id,
        clientTxId: input.clientTransactionId,
      });
      if (!result.reached) {
        // Unknown, so still pending; its id is what lets the sweep ask again.
        await setAttempt(tx, attempt.id, { payphoneTransactionId: input.id });
        logger.warn(`Payphone confirm did not answer: ${result.error}`, {
          event: 'payphone.unreachable',
          tenantId,
        });
        return { status: 'PENDING', paymentId: attempt.paymentId };
      }
      const status = await settle(
        tx,
        { ...attempt, payphoneTransactionId: input.id },
        result,
        now,
        logger,
      );
      return { status, paymentId: attempt.paymentId };
    });
  } catch (error) {
    // Whatever failed after Payphone answered, its id must still land on the attempt, or the
    // sweep reads "never came back" and expires a captured charge.
    if (attemptId) await keepPayphoneId(db, attemptId, input.id, logger);
    throw error;
  }
  if (outcome.status === 'APPROVED') {
    const applied = await applyCardAttempt(db, attemptId!, now, logger, notice);
    return { ...outcome, status: applied };
  }
  return outcome;
}

async function keepPayphoneId(db: Database, attemptId: string, id: number, logger: Logger) {
  try {
    await db.withSystem('payphone: keep the transaction id after a failed confirm', ({ db: tx }) =>
      tx
        .update(schema.payphoneTransactions)
        .set({ payphoneTransactionId: id })
        .where(
          and(
            eq(schema.payphoneTransactions.id, attemptId),
            eq(schema.payphoneTransactions.status, 'PENDING'),
          ),
        ),
    );
  } catch (error) {
    logger.error(`Could not keep Payphone's id ${id} on a card attempt: ${String(error)}`, {
      event: 'payphone.id_lost',
    });
  }
}

// Phase two, like an operator's verification: the payment is verified and applied in one
// transaction with the attempt's applied_at. A payment someone else settled first, by another
// attempt or a transfer, or one cancelled meanwhile, makes this charge a duplicate.
export async function applyCardAttempt(
  db: Database,
  attemptId: string,
  now: Date,
  logger: Logger,
  notice: NotifyDeps,
): Promise<CardAttemptStatus> {
  return db.withSystem('payphone: apply an approved card charge', async (txAll) => {
    const tx = txAll.db;
    const [attempt] = await tx
      .select()
      .from(schema.payphoneTransactions)
      .where(eq(schema.payphoneTransactions.id, attemptId))
      .for('update');
    if (!attempt || attempt.status !== 'APPROVED' || attempt.appliedAt)
      return attempt?.status ?? 'ERROR';
    const payment = await lockPayment(tx, attempt.paymentId);
    if (!['PENDING', 'REPORTED', 'REJECTED'].includes(payment.status))
      return flagDuplicate(tx, attempt, payment, logger);
    await tx
      .update(schema.payments)
      .set({
        status: 'VERIFIED',
        method: 'PAYPHONE_CARD',
        verifiedAt: now,
        verifiedBy: null,
        rejectionReason: null,
      })
      .where(eq(schema.payments.id, payment.id));
    await applyVerifiedPayment(tx, payment, now);
    await setAttempt(tx, attempt.id, { appliedAt: now });
    await recordAudit(tx, {
      tenantId: payment.tenantId,
      actorUserId: null,
      action: 'payment.verified',
      details: { code: payment.code, purpose: payment.purpose, method: 'PAYPHONE_CARD' },
    });
    // The payer is told, and the operator's invoice is now owed (FR-NOT-2, ADR-036).
    await notify(txAll, notice, {
      tenantId: payment.tenantId,
      type: 'PAYMENT_VERIFIED',
      params: { amount: payment.totalAmount, date: ecuadorDate(now), code: payment.code },
    });
    return 'APPROVED';
  });
}

export type ReconcileDeps = {
  db: Database;
  gateway: PayphoneGateway;
  clock: Clock;
  logger: Logger;
  notice: NotifyDeps;
};

// `payphone.reconcile`, every 5 minutes. First, attempts whose answer never arrived: with no
// Payphone id the return page never reached us and Payphone has reversed the charge; with one,
// confirm was tried and lost, and asking again is what recovers a captured charge. Then, approved
// charges whose payment was never applied.
export async function reconcileCardPayments(
  deps: ReconcileDeps,
): Promise<{ settled: number; applied: number }> {
  const now = deps.clock.now();
  const staleBefore = new Date(now.getTime() - CARD_STALE_MINUTES * 60_000);
  const { payphoneTransactions: attempts } = schema;
  const stale = await deps.db.withSystem('payphone: stale card attempts', ({ db: tx }) =>
    tx
      .select({ id: attempts.id })
      .from(attempts)
      .where(and(eq(attempts.status, 'PENDING'), lt(attempts.createdAt, staleBefore))),
  );
  let settled = 0;
  for (const { id } of stale) {
    const status = await deps.db
      .withSystem('payphone: settle a stale card attempt', async ({ db: tx }) => {
        const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, id)).for('update');
        if (!attempt || attempt.status !== 'PENDING') return null;
        if (attempt.payphoneTransactionId === null) {
          await setAttempt(tx, attempt.id, { status: 'EXPIRED', confirmedAt: now });
          return 'EXPIRED';
        }
        const result = await deps.gateway.confirm({
          id: attempt.payphoneTransactionId,
          clientTxId: attempt.clientTransactionId,
        });
        if (!result.reached) return null;
        return settle(tx, attempt, result, now, deps.logger, 'EXPIRED');
      })
      .catch((error: unknown) => {
        deps.logger.error(`Could not settle a card attempt: ${String(error)}`, {
          event: 'payphone.reconcile_failed',
        });
        return null;
      });
    if (status) settled += 1;
  }
  const unapplied = await deps.db.withSystem(
    'payphone: approved card charges not applied',
    ({ db: tx }) =>
      tx
        .select({ id: attempts.id })
        .from(attempts)
        .where(and(eq(attempts.status, 'APPROVED'), isNull(attempts.appliedAt))),
  );
  let applied = 0;
  for (const { id } of unapplied) {
    try {
      if ((await applyCardAttempt(deps.db, id, now, deps.logger, deps.notice)) === 'APPROVED')
        applied += 1;
    } catch (error) {
      deps.logger.error(`Could not apply an approved card charge: ${String(error)}`, {
        event: 'payphone.apply_failed',
      });
    }
  }
  if (settled + applied > 0)
    deps.logger.info(`Payphone sweep: ${settled} attempts settled, ${applied} charges applied`, {
      event: 'payphone.reconciled',
    });
  return { settled, applied };
}
