import { createHash } from 'node:crypto';
import { type Tx } from '@comprobify/db';
import { z } from 'zod';
import {
  amountInput,
  Dec,
  preciseInput,
  requirePermission,
  toSriAmount,
  type ActorContext,
} from '../kernel';
import { documentTotals, SRI_PAYMENT_METHODS, SRI_TERM_UNITS } from '../sri';
import { findIssuedByKey, type IssueDeps, type IssuedDocument } from './compose';
import { invoiceInput, issueInvoice } from './create-invoice';

// FR-BULK-1 (ADR-026): one invoice of a CSV batch, as the file's rows described it once they were
// validated. The lines carry what the catalogue said then, so the batch bills what was checked.
export const csvInvoiceRow = z.object({
  // What the file called the invoice; shown on the stack view.
  reference: z.string().trim().min(1).max(100),
  // Null is consumidor final.
  clientId: z.uuid().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        code: z.string().trim().min(1).max(25),
        auxiliaryCode: z.string().trim().min(1).max(25).nullable().default(null),
        name: z.string().trim().min(1).max(300),
        unit: z.string().trim().min(1).max(50).nullable().default(null),
        quantity: preciseInput.refine((value) => new Dec(value).gt(0), 'Must be more than 0'),
        unitPrice: preciseInput,
        discount: amountInput.default('0'),
        ivaRateCode: z.string(),
      }),
    )
    .min(1)
    .max(500),
});
export type CsvInvoiceRow = z.input<typeof csvInvoiceRow>;

export const csvInvoicePayment = z.object({
  method: z.enum(SRI_PAYMENT_METHODS),
  term: z.int().min(0).max(9999).nullable().default(null),
  termUnit: z.enum(SRI_TERM_UNITS).nullable().default(null),
});

// One payment for the whole total, as the order batch does. In the caller's transaction, so the
// item and its invoice commit together; the key makes a retried job find the invoice it made.
export async function invoiceFromCsvRow(
  ctx: ActorContext,
  tx: Tx,
  input: {
    row: unknown;
    issuePointId: string;
    payment: z.input<typeof csvInvoicePayment>;
    idempotencyKey: string;
  },
  deps: IssueDeps,
): Promise<IssuedDocument> {
  requirePermission(ctx, 'documents.issue');
  const made = await findIssuedByKey(tx, ctx, input.idempotencyKey);
  if (made) return made;
  const row = csvInvoiceRow.parse(input.row);
  const payment = csvInvoicePayment.parse(input.payment);
  const content = invoiceInput.parse({
    issuePointId: input.issuePointId,
    clientId: row.clientId,
    lines: row.lines,
    payments: [{ ...payment, amount: toSriAmount(documentTotals(row.lines).total) }],
    idempotencyKey: input.idempotencyKey,
  });
  const payloadHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return issueInvoice(ctx, tx, content, payloadHash, deps);
}
