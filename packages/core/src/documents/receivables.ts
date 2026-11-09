import { and, eq, inArray, schema, sql, type Tx } from '@comprobify/db';
import { addDays, addMonths, Dec, DomainError, type ActorContext } from '../kernel';
import { documentNumber } from './queries';

// FR-SAL-10 (ADR-024): what the receivables module needs to know about invoices, so it never
// reads their tables. An invoice is owed once SRI authorizes it, for its total less the
// authorized credit notes made against it.

export type ReceivableInvoice = {
  id: string;
  number: string;
  issueDate: string;
  // When the last of the invoice's terms ends; its issue date when it states none.
  dueDate: string;
  clientId: string | null;
  buyerName: string;
  buyerIdentification: string;
  total: string;
  // Authorized credit notes, which reduce what is owed.
  credited: string;
};

type Row = typeof schema.documents.$inferSelect;

// An invoice's due date from the longest plazo of its payment lines (ADR-024).
export async function dueDates(tx: Tx, rows: Row[]): Promise<Map<string, string>> {
  const { documentPayments } = schema;
  const due = new Map(rows.map((row) => [row.id, row.issueDate]));
  if (rows.length === 0) return due;
  const terms = await tx.db
    .select({
      documentId: documentPayments.documentId,
      revision: documentPayments.revision,
      term: documentPayments.term,
      termUnit: documentPayments.termUnit,
    })
    .from(documentPayments)
    .where(
      and(
        inArray(
          documentPayments.documentId,
          rows.map((row) => row.id),
        ),
        sql`${documentPayments.term} IS NOT NULL`,
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const entry of terms) {
    const row = byId.get(entry.documentId)!;
    if (entry.revision !== row.revision || entry.term === null) continue;
    const at =
      entry.termUnit === 'meses'
        ? addMonths(row.issueDate, entry.term)
        : addDays(row.issueDate, entry.term);
    if (at > due.get(row.id)!) due.set(row.id, at);
  }
  return due;
}

async function creditedBy(tx: Tx, ids: string[]): Promise<Map<string, Dec>> {
  const { documents } = schema;
  if (ids.length === 0) return new Map();
  const rows = await tx.db
    .select({
      invoiceId: documents.relatedDocumentId,
      credited: sql<string>`sum(${documents.total})`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.documentType, '04'),
        eq(documents.status, 'AUTHORIZED'),
        inArray(documents.relatedDocumentId, ids),
      ),
    )
    .groupBy(documents.relatedDocumentId);
  return new Map(rows.map((row) => [row.invoiceId!, new Dec(row.credited)]));
}

async function facts(tx: Tx, rows: Row[]): Promise<ReceivableInvoice[]> {
  // One after another: a transaction is one connection, which runs one query at a time.
  const due = await dueDates(tx, rows);
  const credited = await creditedBy(
    tx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    number: documentNumber(row.series, row.sequential),
    issueDate: row.issueDate,
    dueDate: due.get(row.id)!,
    clientId: row.clientId,
    buyerName: row.buyerName,
    buyerIdentification: row.buyerIdentification,
    total: row.total,
    credited: (credited.get(row.id) ?? new Dec(0)).toFixed(2),
  }));
}

const visible = (ctx: ActorContext) =>
  ctx.issuePointIds === null
    ? undefined
    : inArray(schema.documents.issuePointId, [...ctx.issuePointIds]);

// Every authorized invoice, for the aging report. The receivables module subtracts payments.
export async function receivableInvoices(ctx: ActorContext, tx: Tx): Promise<ReceivableInvoice[]> {
  const { documents } = schema;
  const rows = await tx.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, ctx.tenantId),
        eq(documents.documentType, '01'),
        eq(documents.status, 'AUTHORIZED'),
        visible(ctx),
      ),
    );
  return facts(tx, rows);
}

// One invoice that can be collected, locked when a payment is about to change its balance so
// two payments at once can't both take the same part of it.
export async function receivableInvoice(
  ctx: ActorContext,
  tx: Tx,
  id: string,
  options: { lock?: boolean } = {},
): Promise<ReceivableInvoice> {
  const { documents } = schema;
  const query = tx.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId), visible(ctx)));
  const [row] = options.lock ? await query.for('update') : await query;
  if (!row || row.documentType !== '01') throw new DomainError('NOT_FOUND', 'Invoice not found');
  if (row.status !== 'AUTHORIZED')
    throw new DomainError('NOT_RECEIVABLE', 'Only an authorized invoice is collected', {
      status: row.status,
    });
  return (await facts(tx, [row]))[0]!;
}
