import type { Database } from '@comprobify/db';
import { z } from 'zod';
import { paymentToInvoice, setPaymentInvoiced } from '../billing';
import { documentByAccessKey } from '../documents';
import { assertSuperAdmin } from '../identity';
import { Dec, DomainError, type PlatformActor } from '../kernel';

export const markInvoicedInput = z.object({
  paymentId: z.uuid(),
  accessKey: z.string().regex(/^\d{49}$/),
});

// FR-BILL-4: the operator issued, from its own company, the invoice for a verified payment and
// records it by the access key. It must be an authorized factura for that company's RUC and for
// what it paid, so a typo can't close the wrong payment.
export async function markPaymentInvoiced(
  actor: PlatformActor,
  db: Database,
  raw: z.input<typeof markInvoicedInput>,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const input = markInvoicedInput.parse(raw);
  await db.withSystem('super admin: record the invoice for a payment', async ({ db: tx }) => {
    const owed = await paymentToInvoice(tx, input.paymentId);
    const invoice = await documentByAccessKey(tx, input.accessKey);
    if (!invoice || invoice.documentType !== '01')
      throw new DomainError('INVOICE_NOT_FOUND', 'No factura has that access key');
    if (invoice.status !== 'AUTHORIZED')
      throw new DomainError('INVOICE_NOT_AUTHORIZED', 'That factura is not authorized', {
        status: invoice.status,
      });
    if (invoice.buyerIdentification !== owed.ruc)
      throw new DomainError('INVOICE_BUYER_MISMATCH', 'That factura bills someone else');
    if (!new Dec(invoice.total).eq(owed.totalAmount))
      throw new DomainError('INVOICE_TOTAL_MISMATCH', 'That factura is for another amount', {
        invoice: invoice.total,
        payment: owed.totalAmount,
      });
    await setPaymentInvoiced(tx, {
      paymentId: input.paymentId,
      documentId: invoice.id,
      actorUserId: actor.userId,
      now: actor.clock.now(),
    });
  });
}
