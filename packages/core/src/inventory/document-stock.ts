import { and, eq, inArray, schema, sql, type Tx } from '@comprobify/db';
import { stockedAmong } from '../catalog';
import { Dec, hasFeature, type ActorContext } from '../kernel';
import { lockLevel, moveStock, type Mover } from './ledger';

// ADR-020: what SRI documents do to stock. An invoice reserves its goods when it is created,
// sells them when SRI authorizes it, and gets them back if it is voided. A credit note returns
// goods at the cost they left at. Every movement points at its document, so what a document
// holds, sold or got back is read from the ledger, never kept twice.

export type StockLine = { productId: string | null; quantity: string };

type Key = { productId: string; warehouseId: string };
type Held = Key & { quantity: Dec; reserved: Dec; sold: Dec; soldValue: Dec };

const byKey = (a: Key, b: Key) =>
  a.productId.localeCompare(b.productId) || a.warehouseId.localeCompare(b.warehouseId);

// The sums of the movements these documents caused, per product and warehouse.
async function movedBy(tx: Tx, tenantId: string, documentIds: string[]): Promise<Held[]> {
  const { stockMovements: m } = schema;
  const rows = await tx.db
    .select({
      productId: m.productId,
      warehouseId: m.warehouseId,
      quantity: sql<string>`sum(${m.quantity})`,
      reserved: sql<string>`sum(${m.reserved})`,
      sold: sql<string>`coalesce(sum(${m.quantity}) FILTER (WHERE ${m.type} = 'SALE'), 0)`,
      soldValue: sql<string>`coalesce(sum(${m.value}) FILTER (WHERE ${m.type} = 'SALE'), 0)`,
    })
    .from(m)
    .where(
      and(eq(m.tenantId, tenantId), eq(m.sourceType, 'DOCUMENT'), inArray(m.sourceId, documentIds)),
    )
    .groupBy(m.productId, m.warehouseId);
  return rows
    .map((row) => ({
      productId: row.productId,
      warehouseId: row.warehouseId,
      quantity: new Dec(row.quantity),
      reserved: new Dec(row.reserved),
      sold: new Dec(row.sold).neg(),
      soldValue: new Dec(row.soldValue).neg(),
    }))
    .sort(byKey);
}

// Quantities per product, for the lines that are goods tracking stock.
async function stockedTotals(tx: Tx, lines: StockLine[]): Promise<Map<string, Dec>> {
  const ids = [...new Set(lines.flatMap((line) => (line.productId ? [line.productId] : [])))];
  const stocked = await stockedAmong(tx, ids);
  const totals = new Map<string, Dec>();
  for (const line of lines)
    if (line.productId && stocked.has(line.productId))
      totals.set(
        line.productId,
        (totals.get(line.productId) ?? new Dec(0)).add(new Dec(line.quantity)),
      );
  return totals;
}

const source = (documentId: string) => ({ type: 'DOCUMENT' as const, id: documentId });

// When an invoice is created or corrected: its goods are held in its issue point's warehouse,
// under the company's negative-stock rule. Without Inventario nothing is held, then or later.
export async function reserveDocumentStock(
  ctx: ActorContext,
  tx: Tx,
  input: { documentId: string; warehouseId: string; lines: StockLine[] },
): Promise<void> {
  if (!hasFeature(ctx, 'INVENTORY')) return;
  const totals = await stockedTotals(tx, input.lines);
  // In product order, so two documents with the same goods lock their levels alike.
  for (const productId of [...totals.keys()].sort())
    await moveStock(
      tx,
      { tenantId: ctx.tenantId, userId: ctx.userId ?? null },
      {
        type: 'RESERVATION',
        productId,
        warehouseId: input.warehouseId,
        quantity: totals.get(productId)!.toFixed(6),
        source: source(input.documentId),
      },
    );
}

// Before a correction reserves its new lines: whatever the document still holds is let go.
export async function releaseDocumentStock(
  tx: Tx,
  mover: Mover,
  documentId: string,
): Promise<void> {
  for (const held of await movedBy(tx, mover.tenantId, [documentId]))
    if (held.reserved.gt(0))
      await moveStock(tx, mover, {
        type: 'RELEASE',
        productId: held.productId,
        warehouseId: held.warehouseId,
        quantity: held.reserved.toFixed(6),
        source: source(documentId),
      });
}

// When SRI authorizes an invoice: what it holds leaves, at the average.
export async function sellDocumentStock(tx: Tx, mover: Mover, documentId: string): Promise<void> {
  for (const held of await movedBy(tx, mover.tenantId, [documentId]))
    if (held.reserved.gt(0))
      await moveStock(tx, mover, {
        type: 'SALE',
        productId: held.productId,
        warehouseId: held.warehouseId,
        quantity: held.reserved.toFixed(6),
        source: source(documentId),
      });
}

// Goods an invoice sold come back where they left from, at the cost they left at. `returns` are
// the documents that already brought some back (its credit notes, and the invoice itself once
// voided), so nothing comes back twice. Null lines bring back everything that's left: a void.
export async function returnSoldStock(
  tx: Tx,
  mover: Mover,
  input: {
    invoiceId: string;
    returns: string[];
    into: string;
    lines: StockLine[] | null;
  },
): Promise<void> {
  const sales = (await movedBy(tx, mover.tenantId, [input.invoiceId])).filter((held) =>
    held.sold.gt(0),
  );
  // A product that stopped tracking stock since has no level to come back to.
  const stocked = await stockedAmong(
    tx,
    sales.map((sale) => sale.productId),
  );
  const keys = sales.filter((sale) => stocked.has(sale.productId));
  if (keys.length === 0) return;
  // Locked before what's left is read, so a void and a credit note at once can't both return it.
  for (const key of keys) await lockLevel(tx, mover.tenantId, key.productId, key.warehouseId);
  const moved = await movedBy(tx, mover.tenantId, [
    ...new Set([input.invoiceId, input.into, ...input.returns]),
  ]);
  const wanted = input.lines ? await stockedTotals(tx, input.lines) : null;

  for (const sale of keys) {
    const net = moved.find((row) => byKey(row, sale) === 0)!;
    // The movements of the invoice and its returns sum to minus what is still out.
    let quantity = net.quantity.neg();
    if (wanted) {
      const asked = wanted.get(sale.productId) ?? new Dec(0);
      quantity = Dec.min(quantity, asked);
      wanted.set(sale.productId, asked.sub(quantity));
    }
    if (!quantity.gt(0)) continue;
    await moveStock(tx, mover, {
      type: 'RETURN_IN',
      productId: sale.productId,
      warehouseId: sale.warehouseId,
      quantity: quantity.toFixed(6),
      unitCost: sale.soldValue.div(sale.sold).toDecimalPlaces(6).toFixed(6),
      source: source(input.into),
    });
  }
}

// Whether an invoice still has goods out that a credit note could bring back.
export async function goodsStillOut(
  tx: Tx,
  tenantId: string,
  documentIds: string[],
): Promise<boolean> {
  return (await movedBy(tx, tenantId, documentIds)).some((row) => row.quantity.lt(0));
}

// A voided credit note takes back out what it returned, at the average, whatever the
// negative-stock rule: SRI has already voided it.
export async function undoReturn(tx: Tx, mover: Mover, creditNoteId: string): Promise<void> {
  const returned = await movedBy(tx, mover.tenantId, [creditNoteId]);
  const stocked = await stockedAmong(
    tx,
    returned.map((row) => row.productId),
  );
  for (const row of returned)
    if (row.quantity.gt(0) && stocked.has(row.productId))
      await moveStock(
        tx,
        mover,
        {
          type: 'ADJUSTMENT_OUT',
          productId: row.productId,
          warehouseId: row.warehouseId,
          quantity: row.quantity.toFixed(6),
          source: source(creditNoteId),
        },
        { anyRule: true },
      );
}
