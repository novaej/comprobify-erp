import { schema, type Database } from '@comprobify/db';
import { z } from 'zod';
import { productsToSell } from '../catalog';
import { csvInvoicePayment, csvInvoiceRow } from '../documents';
import type { Jobs } from '../jobs';
import {
  amountInput,
  csvDecimal,
  Dec,
  DomainError,
  preciseInput,
  readCsvTable,
  requireFeature,
  requirePermission,
  type ActorContext,
  type CsvColumns,
  type CsvProblem,
} from '../kernel';
import { clientsByIdentification } from '../parties';
import { documentTotals } from '../sri';
import { issuePointWarehouse } from '../tenancy';
import { MAX_BATCH_ITEMS } from './batches';

// FR-BULK-1 (ADR-026): a CSV file starts a batch of invoices. Each row is one line; rows with the
// same reference are the lines of one invoice. The whole file is checked before anything is
// queued: one wrong row, and nothing starts, with every problem named by its line.
export const CSV_BATCH_MAX_ROWS = 50_000;
const MAX_LINES = 500;

type Key = 'reference' | 'client' | 'product' | 'quantity' | 'unitPrice' | 'discount';

const COLUMNS: CsvColumns<Key> = {
  reference: ['reference', 'referencia', 'invoice', 'factura', 'document', 'documento'],
  client: ['client', 'cliente', 'identification', 'identificacion', 'customer'],
  product: ['product', 'producto', 'code', 'codigo', 'product_code', 'codigo_producto'],
  quantity: ['quantity', 'cantidad'],
  unitPrice: ['unit_price', 'price', 'precio', 'precio_unitario'],
  discount: ['discount', 'descuento'],
};

const FIELD: Record<string, string> = {
  quantity: 'quantity',
  unitPrice: 'unit_price',
  discount: 'discount',
};

export const startCsvBatchInput = z.object({
  text: z.string(),
  issuePointId: z.uuid(),
  payment: csvInvoicePayment,
});
export type StartCsvBatchInput = z.input<typeof startCsvBatchInput>;

export type CsvBatchResult =
  | { batch: { id: string; totalItems: number }; problems: [] }
  | { batch: null; problems: CsvProblem[] };

type Group = {
  line: number;
  clientKey: string;
  clientId: string | null;
  lines: z.input<typeof csvInvoiceRow>['lines'];
  tooMany: boolean;
};

export async function startCsvBatch(
  ctx: ActorContext,
  db: Database,
  raw: StartCsvBatchInput,
  deps: { jobs: Pick<Jobs, 'enqueue'>; consumerFinalMaxAmount: string },
): Promise<CsvBatchResult> {
  requireFeature(ctx, 'BULK_INVOICING');
  requireFeature(ctx, 'CATALOG');
  requirePermission(ctx, 'documents.issue');
  const input = startCsvBatchInput.parse(raw);
  const csv = readCsvTable<Key>(
    input.text,
    COLUMNS,
    ['reference', 'product', 'quantity'],
    CSV_BATCH_MAX_ROWS,
  );

  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    try {
      await issuePointWarehouse(tx, input.issuePointId);
    } catch {
      throw new DomainError('NOT_FOUND', 'Issue point not found');
    }
    const products = new Map(
      (await productsToSell(tx, [...new Set(csv.rows.map((row) => row.cell('product')))])).map(
        (product) => [product.code, product],
      ),
    );
    const identifications = [
      ...new Set(
        csv.rows.map((row) => row.cell('client').toUpperCase()).filter((value) => value !== ''),
      ),
    ];
    const clients = new Map(
      (await clientsByIdentification(tx, identifications)).map((client) => [
        client.identification,
        client,
      ]),
    );

    const problems: CsvProblem[] = [];
    const groups = new Map<string, Group>();
    for (const row of csv.rows) {
      const bad = (code: string, field?: string) =>
        problems.push({ line: row.line, code, ...(field ? { field } : {}) });
      const reference = row.cell('reference');
      if (!reference) {
        bad('REFERENCE_REQUIRED', 'reference');
        continue;
      }
      let ok = true;
      const product = products.get(row.cell('product'));
      if (!product) {
        bad('PRODUCT_NOT_FOUND', 'product');
        ok = false;
      } else if (!product.active) {
        bad('PRODUCT_INACTIVE', 'product');
        ok = false;
      }
      const clientKey = row.cell('client').toUpperCase();
      const client = clientKey ? clients.get(clientKey) : null;
      if (clientKey && !client) {
        bad('CLIENT_NOT_FOUND', 'client');
        ok = false;
      } else if (client && !client.active) {
        bad('CLIENT_INACTIVE', 'client');
        ok = false;
      }
      const group = groups.get(reference) ?? {
        line: row.line,
        clientKey,
        clientId: client?.id ?? null,
        lines: [],
        tooMany: false,
      };
      groups.set(reference, group);
      if (group.clientKey !== clientKey) {
        bad('CLIENT_MISMATCH', 'client');
        ok = false;
      }
      if (group.lines.length >= MAX_LINES && !group.tooMany) {
        group.tooMany = true;
        bad('TOO_MANY_LINES', 'reference');
        ok = false;
      }
      const quantity = csvDecimal(row.cell('quantity'), csv.delimiter);
      const unitPrice =
        row.cell('unitPrice') === '' ? undefined : csvDecimal(row.cell('unitPrice'), csv.delimiter);
      const discount =
        row.cell('discount') === '' ? '0' : csvDecimal(row.cell('discount'), csv.delimiter);
      const checked = z
        .object({
          quantity: preciseInput.refine((value) => new Dec(value).gt(0)),
          unitPrice: preciseInput,
          discount: amountInput,
        })
        .safeParse({ quantity, unitPrice: unitPrice ?? product?.price ?? '0', discount });
      if (!checked.success) {
        bad('INVALID_FIELD', FIELD[String(checked.error.issues[0]?.path[0])] ?? 'quantity');
        ok = false;
      } else if (
        new Dec(checked.data.quantity).mul(checked.data.unitPrice).lt(checked.data.discount)
      ) {
        bad('DISCOUNT_TOO_LARGE', 'discount');
        ok = false;
      }
      if (ok && product && checked.success)
        group.lines.push({
          productId: product.id,
          code: product.code,
          auxiliaryCode: product.auxiliaryCode,
          name: product.name,
          unit: product.unit,
          quantity: checked.data.quantity,
          unitPrice: checked.data.unitPrice,
          discount: checked.data.discount,
          ivaRateCode: product.ivaRateCode,
        });
    }
    // Consumidor final can't be billed past the limit, which only the whole invoice shows.
    if (problems.length === 0)
      for (const group of groups.values())
        if (
          group.clientKey === '' &&
          documentTotals(
            group.lines.map((line) => ({
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount ?? '0',
              ivaRateCode: line.ivaRateCode,
            })),
          ).total.gt(deps.consumerFinalMaxAmount)
        )
          problems.push({ line: group.line, code: 'CONSUMER_FINAL_LIMIT', field: 'client' });
    if (problems.length > 0) return { batch: null, problems };

    if (groups.size > MAX_BATCH_ITEMS)
      throw new DomainError('IMPORT_TOO_LARGE', 'The file has too many invoices', {
        max: MAX_BATCH_ITEMS,
      });
    const rows = [...groups.entries()].map(([reference, group]) =>
      csvInvoiceRow.parse({ reference, clientId: group.clientId, lines: group.lines }),
    );
    const [batch] = await tx.db
      .insert(schema.bulkBatches)
      .values({
        tenantId: ctx.tenantId,
        source: 'CSV',
        issuePointId: input.issuePointId,
        paymentMethod: input.payment.method,
        paymentTerm: input.payment.term,
        paymentTermUnit: input.payment.termUnit,
        totalItems: rows.length,
        createdBy: ctx.userId ?? null,
      })
      .returning({ id: schema.bulkBatches.id });
    const chunk = 1000;
    for (let from = 0; from < rows.length; from += chunk)
      await tx.db.insert(schema.bulkBatchItems).values(
        rows.slice(from, from + chunk).map((row, index) => ({
          tenantId: ctx.tenantId,
          batchId: batch!.id,
          position: from + index + 1,
          input: row,
        })),
      );
    // With the batch, so a batch that commits is a batch the feeder is told about.
    await deps.jobs.enqueue(tx, 'bulk.feed', {});
    return { batch: { id: batch!.id, totalItems: rows.length }, problems: [] };
  });
}
