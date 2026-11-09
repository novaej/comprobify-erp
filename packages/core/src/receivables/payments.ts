import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  schema,
  sql,
  SRI_PAYMENT_METHODS,
  type Database,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { receivableInvoice, type ReceivableInvoice } from '../documents';
import {
  amountInput,
  Dec,
  DomainError,
  ecuadorDate,
  requireFeature,
  requirePermission,
  toSriAmount,
  type ActorContext,
} from '../kernel';

// FR-SAL-10 (ADR-024): payments recorded by hand against authorized invoices, and the balance
// they leave. The status is worked out from them, never stored.

export type ReceivableStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export function canRead(ctx: ActorContext) {
  requireFeature(ctx, 'RECEIVABLES');
  requirePermission(ctx, 'sales.read');
}

export function canManage(ctx: ActorContext) {
  requireFeature(ctx, 'RECEIVABLES');
  requirePermission(ctx, 'sales.manage');
}

// What is owed: the total, less authorized credit notes, less payments that aren't voided.
export const balanceOf = (invoice: ReceivableInvoice, paid: Dec): Dec =>
  new Dec(invoice.total).sub(invoice.credited).sub(paid);

export function statusOf(invoice: ReceivableInvoice, paid: Dec): ReceivableStatus {
  if (balanceOf(invoice, paid).lte(0)) return 'PAID';
  return paid.gt(0) ? 'PARTIAL' : 'UNPAID';
}

export type Payment = typeof schema.invoicePayments.$inferSelect;

// What each invoice has been paid, ignoring voided payments.
export async function paidBy(tx: Tx, ids?: string[]): Promise<Map<string, Dec>> {
  const { invoicePayments: payments } = schema;
  if (ids && ids.length === 0) return new Map();
  const rows = await tx.db
    .select({ documentId: payments.documentId, paid: sql<string>`sum(${payments.amount})` })
    .from(payments)
    .where(and(isNull(payments.voidedAt), ids ? inArray(payments.documentId, ids) : undefined))
    .groupBy(payments.documentId);
  return new Map(rows.map((row) => [row.documentId, new Dec(row.paid)]));
}

export const paymentInput = z.object({
  documentId: z.uuid(),
  amount: amountInput.refine((value) => new Dec(value).gt(0), 'Must be more than 0'),
  // Null is today, in Ecuador.
  paidOn: z.iso.date().nullable().default(null),
  method: z.enum(SRI_PAYMENT_METHODS),
  reference: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .default(null)
    .transform((value) => value || null),
});
export type PaymentInput = z.input<typeof paymentInput>;

// The invoice is locked, so two payments at once can't both take the same balance.
export async function recordPayment(
  ctx: ActorContext,
  db: Database,
  raw: PaymentInput,
): Promise<Payment> {
  canManage(ctx);
  const input = paymentInput.parse(raw);
  const today = ecuadorDate(ctx.clock.now());
  const paidOn = input.paidOn ?? today;
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const invoice = await receivableInvoice(ctx, tx, input.documentId, { lock: true });
    if (paidOn > today || paidOn < invoice.issueDate)
      throw new DomainError(
        'PAYMENT_DATE_INVALID',
        'A payment is dated from the invoice to today',
        {
          issueDate: invoice.issueDate,
        },
      );
    const paid = (await paidBy(tx, [invoice.id])).get(invoice.id) ?? new Dec(0);
    const balance = balanceOf(invoice, paid);
    if (new Dec(input.amount).gt(balance))
      throw new DomainError('PAYMENT_EXCEEDS_BALANCE', 'A payment can not be more than is owed', {
        balance: toSriAmount(balance),
      });
    const [payment] = await tx.db
      .insert(schema.invoicePayments)
      .values({
        tenantId: ctx.tenantId,
        documentId: invoice.id,
        amount: input.amount,
        paidOn,
        method: input.method,
        reference: input.reference,
        createdBy: ctx.userId ?? null,
      })
      .returning();
    return payment!;
  });
}

export const voidPaymentInput = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1).max(300),
});

// A mistake is voided, never edited or deleted; the balance counts it again.
export async function voidPayment(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof voidPaymentInput>,
): Promise<Payment> {
  canManage(ctx);
  const input = voidPaymentInput.parse(raw);
  const { invoicePayments: payments } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const [found] = await tx.db.select().from(payments).where(eq(payments.id, input.id));
    if (!found) throw new DomainError('NOT_FOUND', 'Payment not found');
    // The invoice's visibility rules apply to its payments.
    const [invoice] = await tx.db
      .select({ id: schema.documents.id, issuePointId: schema.documents.issuePointId })
      .from(schema.documents)
      .where(eq(schema.documents.id, found.documentId));
    if (
      !invoice ||
      (ctx.issuePointIds !== null && !ctx.issuePointIds.includes(invoice.issuePointId))
    )
      throw new DomainError('NOT_FOUND', 'Payment not found');
    const [updated] = await tx.db
      .update(payments)
      .set({ voidedAt: ctx.clock.now(), voidedBy: ctx.userId ?? null, voidReason: input.reason })
      .where(and(eq(payments.id, input.id), isNull(payments.voidedAt)))
      .returning();
    if (!updated) throw new DomainError('PAYMENT_VOIDED', 'This payment was already voided');
    return updated;
  });
}

export type ReceivableView = {
  invoice: ReceivableInvoice;
  paid: string;
  balance: string;
  status: ReceivableStatus;
  payments: Payment[];
};

// One invoice's balance and its payments, voided ones included and marked.
export async function getReceivable(
  ctx: ActorContext,
  db: Database,
  documentId: string,
): Promise<ReceivableView> {
  canRead(ctx);
  const id = z.uuid().parse(documentId);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const invoice = await receivableInvoice(ctx, tx, id);
    const payments = await tx.db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.documentId, id))
      .orderBy(asc(schema.invoicePayments.paidOn), asc(schema.invoicePayments.createdAt));
    const paid = payments
      .filter((payment) => payment.voidedAt === null)
      .reduce((sum, payment) => sum.add(payment.amount), new Dec(0));
    return {
      invoice,
      paid: toSriAmount(paid),
      balance: toSriAmount(balanceOf(invoice, paid)),
      status: statusOf(invoice, paid),
      payments,
    };
  });
}
