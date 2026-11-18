import {
  and,
  DOCUMENT_EVENT_TYPES,
  DOCUMENT_STATUSES,
  eq,
  schema,
  SRI_EXCHANGE_OUTCOMES,
  SRI_OPERATIONS,
  type Database,
} from '@comprobify/db';
import { z } from 'zod';
import { DomainError, requirePermission, type ActorContext } from '../kernel';
import { ivaPercent, readFactura } from '../sri';
import { recordVersion } from './exchanges';

// ADR-049: a factura the previous system issued and SRI already answered, kept as read-only
// history. Its rows come from the authorized XML itself, so the RIDE, the reports and the
// document agree with what SRI holds. No quota, no stock, no send job: it is done.
export const importedDocumentInput = z.object({
  issuePointId: z.uuid(),
  clientId: z.uuid().nullable(),
  buyerEmail: z.string().trim().toLowerCase().pipe(z.email()).nullable(),
  status: z.enum(['AUTHORIZED', 'VOIDED']),
  signedXml: z.string().min(1),
  authorizationXml: z.string().min(1),
  authorizationNumber: z.string().regex(/^[0-9]{10,49}$/),
  authorizedAt: z.date(),
  createdAt: z.date(),
  events: z.array(
    z.object({
      type: z.enum(DOCUMENT_EVENT_TYPES),
      fromStatus: z.enum(DOCUMENT_STATUSES).nullable(),
      toStatus: z.enum(DOCUMENT_STATUSES).nullable(),
      details: z.record(z.string(), z.unknown()),
      occurredAt: z.date(),
    }),
  ),
  exchanges: z.array(
    z.object({
      operation: z.enum(SRI_OPERATIONS),
      outcome: z.enum(SRI_EXCHANGE_OUTCOMES),
      messages: z.array(
        z.object({
          identifier: z.string(),
          message: z.string(),
          additionalInfo: z.string().nullable(),
        }),
      ),
      raw: z.string().nullable(),
      occurredAt: z.date(),
    }),
  ),
});

export async function importDocument(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof importedDocumentInput>,
): Promise<{ id: string; accessKey: string }> {
  requirePermission(ctx, 'documents.issue');
  const input = importedDocumentInput.parse(raw);
  const factura = readFactura(input.authorizationXml);
  const refuse = (message: string): never => {
    throw new DomainError('IMPORT_DOCUMENT_INVALID', message, { accessKey: factura.accessKey });
  };
  if (readFactura(input.signedXml).accessKey !== factura.accessKey)
    refuse('The signed and authorized XML are different documents');
  if (factura.documentType !== '01') refuse('Only facturas are imported');

  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const { tenants, issuePoints, branches, documents } = schema;
    const [point] = await tx.db
      .select({ ruc: tenants.ruc, branch: branches.code, code: issuePoints.code })
      .from(issuePoints)
      .innerJoin(branches, eq(branches.id, issuePoints.branchId))
      .innerJoin(tenants, eq(tenants.id, issuePoints.tenantId))
      .where(and(eq(issuePoints.id, input.issuePointId), eq(issuePoints.tenantId, ctx.tenantId)));
    if (!point) return refuse('No such issue point');
    if (factura.ruc !== point.ruc) refuse('The factura belongs to another RUC');
    if (factura.series !== `${point.branch}${point.code}`)
      refuse('The factura belongs to another issue point');

    const [document] = await tx.db
      .insert(documents)
      .values({
        tenantId: ctx.tenantId,
        issuePointId: input.issuePointId,
        documentType: '01',
        series: factura.series,
        sequential: factura.sequential,
        ambiente: factura.ambiente === '2' ? '2' : '1',
        accessKey: factura.accessKey,
        issueDate: factura.issueDate,
        status: input.status,
        clientId: input.clientId,
        buyerIdType: factura.buyer.idType as (typeof schema.documents.$inferInsert)['buyerIdType'],
        buyerIdentification: factura.buyer.identification,
        buyerName: factura.buyer.name,
        buyerAddress: factura.buyer.address,
        buyerEmail: input.buyerEmail,
        subtotal: factura.subtotal,
        discount: factura.discount,
        taxTotals: factura.taxes.map((tax) => ({
          ...tax,
          percent: ivaPercent(tax.rateCode).toString(),
        })),
        total: factura.total,
        signedXml: input.signedXml,
        authorizationNumber: input.authorizationNumber,
        authorizedAt: input.authorizedAt,
        authorizationXml: input.authorizationXml,
        receivedAt:
          input.exchanges.find((exchange) => exchange.outcome === 'RECEIVED')?.occurredAt ??
          input.authorizedAt,
        createdBy: ctx.userId ?? null,
        createdAt: input.createdAt,
      })
      .returning({ id: documents.id, accessKey: documents.accessKey });
    const ref = { tenantId: ctx.tenantId, documentId: document!.id, revision: 1 };

    await tx.db.insert(schema.documentLines).values(
      factura.lines.map((line, index) => ({
        ...ref,
        position: index + 1,
        code: line.code,
        auxiliaryCode: line.auxiliaryCode,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        ivaRateCode: line.ivaRateCode,
        ivaPercent: ivaPercent(line.ivaRateCode).toString(),
        base: line.base,
        iva: line.iva,
        additionalDetails: line.additionalDetails,
      })),
    );
    if (factura.payments.length > 0)
      await tx.db.insert(schema.documentPayments).values(
        factura.payments.map((payment, index) => ({
          ...ref,
          position: index + 1,
          method: payment.method as (typeof schema.documentPayments.$inferInsert)['method'],
          amount: payment.amount,
          term: payment.term,
          termUnit: payment.termUnit as (typeof schema.documentPayments.$inferInsert)['termUnit'],
        })),
      );
    await recordVersion(tx, {
      tenantId: ctx.tenantId,
      documentId: document!.id,
      reason: 'CREATED',
      revision: 1,
      accessKey: factura.accessKey,
      issueDate: factura.issueDate,
      signedXml: input.signedXml,
      actorUserId: ctx.userId ?? null,
    });
    if (input.events.length > 0)
      await tx.db.insert(schema.documentEvents).values(
        input.events.map((event) => ({
          tenantId: ctx.tenantId,
          documentId: document!.id,
          ...event,
        })),
      );
    if (input.exchanges.length > 0)
      await tx.db.insert(schema.sriExchanges).values(
        input.exchanges.map((exchange) => ({
          tenantId: ctx.tenantId,
          documentId: document!.id,
          ...exchange,
          source: 'sri' as const,
          // The previous system kept no timings.
          durationMs: 0,
        })),
      );
    return document!;
  });
}
