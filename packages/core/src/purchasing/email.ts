import type { Logger } from '@comprobify/config/logger';
import { and, asc, eq, schema, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { renderPurchaseOrderEmail, type EmailProvider } from '../email';
import { loadEntitlements } from '../entitlements';
import type { Jobs, QueuePayload } from '../jobs';
import { Dec, DomainError, toSriAmount, type ActorContext, type Clock } from '../kernel';
import { ivaPercent } from '../sri';
import { companyHeader, documentLogo, warehousesOf } from '../tenancy';
import { renderPurchaseOrderPdf, type OrderPdfData } from './order-pdf';
import { canManage, canRead, lockOrder } from './shared';
import { assertPurchaseOrderTransition, purchaseOrderNumber } from './status';

// FR-PUR-3: the order's PDF, to see on screen or to email to the provider. Emailing a draft
// sends it: the status changes and the job is enqueued in one transaction (rule 10).

const ivaLabel = (code: string) =>
  code === '6'
    ? 'No objeto de IVA'
    : code === '7'
      ? 'Exento de IVA'
      : `IVA ${ivaPercent(code).toString()}%`;

// Everything the PDF shows, read in the caller's transaction. The logo needs RIDE_LOGO, as on
// the company's documents.
async function pdfData(
  tx: Tx,
  tenantId: string,
  orderId: string,
  features: readonly string[],
): Promise<{ data: OrderPdfData; status: string; filename: string }> {
  const [order] = await tx.db
    .select()
    .from(schema.purchaseOrders)
    .where(eq(schema.purchaseOrders.id, orderId));
  if (!order) throw new DomainError('NOT_FOUND', 'Purchase order not found');
  const [provider] = await tx.db
    .select()
    .from(schema.providers)
    .where(eq(schema.providers.id, order.providerId));
  const warehouse = (await warehousesOf(tx)).find((item) => item.id === order.warehouseId)!;
  const lines = await tx.db
    .select()
    .from(schema.purchaseOrderLines)
    .where(
      and(
        eq(schema.purchaseOrderLines.orderId, order.id),
        eq(schema.purchaseOrderLines.revision, order.revision),
      ),
    )
    .orderBy(asc(schema.purchaseOrderLines.position));
  const company = await companyHeader(tx, tenantId);
  const taxes = new Map<string, Dec>();
  for (const line of lines)
    if (new Dec(line.iva).gt(0))
      taxes.set(line.ivaRateCode, (taxes.get(line.ivaRateCode) ?? new Dec(0)).add(line.iva));
  const number = purchaseOrderNumber(order.number);
  return {
    status: order.status,
    filename: `Orden de compra ${number}.pdf`,
    data: {
      number,
      orderDate: order.orderDate,
      expectedDate: order.expectedDate,
      notes: order.notes,
      test: company.mode === 'TEST',
      company,
      logo: await documentLogo(tx, tenantId, features),
      provider: {
        name: provider!.name,
        identification: provider!.identification,
        emails: provider!.emails,
      },
      delivery: {
        warehouse: `${warehouse.branchCode} ${warehouse.name}`,
        address: warehouse.branchAddress,
      },
      lines: lines.map((line) => ({
        code: line.code,
        name: line.name,
        unit: line.unit,
        quantity: line.quantity,
        unitCost: line.unitCost,
        ivaLabel: ivaLabel(line.ivaRateCode),
        subtotal: line.subtotal,
      })),
      totals: {
        subtotal: order.subtotal,
        taxes: [...taxes].map(([code, value]) => ({
          label: ivaLabel(code),
          value: toSriAmount(value),
        })),
        total: order.total,
      },
    },
  };
}

// The PDF for the screen, as it would be emailed.
export async function purchaseOrderPdf(
  ctx: ActorContext,
  db: Database,
  id: string,
): Promise<{ filename: string; content: Buffer }> {
  canRead(ctx);
  const orderId = z.uuid().parse(id);
  const { data, filename } = await db.withTenant({ tenantId: ctx.tenantId }, (tx) =>
    pdfData(tx, ctx.tenantId, orderId, ctx.entitlements.features),
  );
  return { filename, content: await renderPurchaseOrderPdf(data) };
}

export const emailOrderInput = z.object({
  id: z.uuid(),
  to: z
    .array(z.string().trim().toLowerCase().pipe(z.email()))
    .min(1)
    .max(10)
    .transform((list) => [...new Set(list)]),
});

// A draft is sent by it; a sent order, or one partly received, gets another copy.
export async function emailPurchaseOrder(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof emailOrderInput>,
  deps: { jobs: Pick<Jobs, 'enqueue'> },
): Promise<void> {
  canManage(ctx);
  const input = emailOrderInput.parse(raw);
  await db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const order = await lockOrder(tx, input.id);
    if (order.status === 'DRAFT') {
      assertPurchaseOrderTransition(order.status, 'SENT');
      await tx.db
        .update(schema.purchaseOrders)
        .set({ status: 'SENT', sentAt: ctx.clock.now() })
        .where(eq(schema.purchaseOrders.id, order.id));
    } else if (order.status !== 'SENT' && order.status !== 'PARTIALLY_RECEIVED')
      throw new DomainError('ORDER_NOT_EMAILABLE', 'This order is no longer sent to the provider', {
        status: order.status,
      });
    await deps.jobs.enqueue(tx, 'purchasing.email', {
      tenantId: ctx.tenantId,
      orderId: order.id,
      to: input.to,
    });
  });
}

export type OrderEmailDeps = {
  db: Database;
  provider: EmailProvider;
  clock: Clock;
  logger: Logger;
};

// The purchasing.email job. It re-reads the order, so the PDF is the order as it is now; a
// cancelled one is not sent. A retry after a partial failure may send a copy twice, which
// the provider can ignore (NFR-JOB-1).
export async function sendPurchaseOrderEmail(
  deps: OrderEmailDeps,
  job: QueuePayload<'purchasing.email'>,
): Promise<void> {
  const { db, provider, clock, logger } = deps;
  const prepared = await db.withTenant({ tenantId: job.tenantId }, async (tx) => {
    const entitlements = await loadEntitlements(tx.db, job.tenantId, clock.now());
    return pdfData(tx, job.tenantId, job.orderId, entitlements.features);
  });
  if (prepared.status === 'CANCELLED' || prepared.status === 'DRAFT') return;
  const { data, filename } = prepared;
  const content = await renderPurchaseOrderPdf(data);
  const results = [];
  for (const to of job.to) {
    const message = renderPurchaseOrderEmail(to, {
      organization: data.company.legalName,
      ruc: data.company.ruc,
      providerName: data.provider.name,
      number: data.number,
      orderDate: data.orderDate.split('-').reverse().join('/'),
      expectedDate: data.expectedDate?.split('-').reverse().join('/') ?? null,
      total: data.totals.total,
      attachment: filename,
      test: data.test,
    });
    results.push(
      await provider.send({
        ...message,
        attachments: [{ filename, content, contentType: 'application/pdf' }],
        variables: { 'purchase-order-id': job.orderId, 'tenant-id': job.tenantId },
      }),
    );
  }
  // EMAIL_PROVIDER=none: nothing went out, so the order says nothing.
  if (results.every((result) => result === 'skipped')) {
    logger.info('The purchase order was not emailed: email is off', {
      event: 'purchasing.email_skipped',
      tenantId: job.tenantId,
    });
    return;
  }
  await db.withTenant({ tenantId: job.tenantId }, ({ db: tx }) =>
    tx
      .update(schema.purchaseOrders)
      .set({ emailedAt: clock.now(), emailedTo: job.to })
      .where(eq(schema.purchaseOrders.id, job.orderId)),
  );
  logger.info('Purchase order emailed to the provider', {
    event: 'purchasing.emailed',
    tenantId: job.tenantId,
  });
}
