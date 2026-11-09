import { and, eq, schema, sql, type Tx } from '@comprobify/db';
import {
  goodsStillOut,
  returnHoldToOrder,
  returnSoldStock,
  sellDocumentStock,
  undoReturn,
  type Mover,
} from '../inventory';
import { orderOfDocument, syncSaleOrder } from '../sales';
import type { Row } from './sending';

// ADR-020: the stock side of SRI's answers, in the transaction that records them.

// The invoice's credit notes: what they returned isn't returned again.
async function creditNotesOf(tx: Tx, invoice: Row): Promise<string[]> {
  const { documents } = schema;
  const rows = await tx.db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, invoice.tenantId),
        eq(documents.relatedDocumentId, invoice.id),
        eq(documents.documentType, '04'),
      ),
    );
  return rows.map((row) => row.id);
}

// An authorized invoice sells what it holds; an authorized credit note that returns goods
// brings back its return lines, up to what the invoice sold and hasn't had back.
export async function stockOnAuthorized(tx: Tx, row: Row): Promise<void> {
  const mover: Mover = { tenantId: row.tenantId, userId: null };
  if (row.documentType === '01') {
    await sellDocumentStock(tx, mover, row.id);
    // Authorized invoices are what finish an order (FR-SAL-4).
    const orderId = await orderOfDocument(tx, row.id);
    if (orderId) await syncSaleOrder(tx, orderId);
    return;
  }
  if (row.documentType !== '04' || !row.returnsStock || !row.relatedDocumentId) return;
  const { documents, documentLines } = schema;
  const [invoice] = await tx.db
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, row.tenantId), eq(documents.id, row.relatedDocumentId)));
  if (!invoice) return;
  const lines = await tx.db
    .select({ productId: documentLines.productId, quantity: documentLines.quantity })
    .from(documentLines)
    .where(
      and(
        eq(documentLines.documentId, row.id),
        eq(documentLines.revision, row.revision),
        // An amount credits value only: no goods come back.
        sql`coalesce(${documentLines.creditKind}, 'RETURN') <> 'AMOUNT'`,
      ),
    );
  await returnSoldStock(tx, mover, {
    invoiceId: invoice.id,
    returns: [invoice.id, ...(await creditNotesOf(tx, invoice))],
    into: row.id,
    lines,
  });
}

// A voided invoice gets back everything still out; a voided credit note takes back its return.
export async function stockOnVoided(tx: Tx, row: Row, userId: string | null): Promise<void> {
  const mover: Mover = { tenantId: row.tenantId, userId };
  if (row.documentType === '01') {
    await returnSoldStock(tx, mover, {
      invoiceId: row.id,
      returns: await creditNotesOf(tx, row),
      into: row.id,
      lines: null,
    });
    // Only a voided invoice gives its quantities back to the order, and its hold (FR-SAL-4).
    const orderId = await orderOfDocument(tx, row.id);
    if (orderId) {
      await returnHoldToOrder(tx, mover, { orderId, documentId: row.id });
      await syncSaleOrder(tx, orderId);
    }
    return;
  }
  if (row.documentType === '04') return undoReturn(tx, mover, row.id);
}

// Whether a credit note on this invoice can offer to bring goods back (FR-SAL-8).
export async function invoiceHasGoodsOut(tx: Tx, invoice: Row): Promise<boolean> {
  return goodsStillOut(tx, invoice.tenantId, [invoice.id, ...(await creditNotesOf(tx, invoice))]);
}
