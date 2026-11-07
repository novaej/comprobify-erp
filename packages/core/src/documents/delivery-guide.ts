import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, schema, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import {
  DomainError,
  ecuadorDate,
  preciseInput,
  requireFeature,
  requirePermission,
  type ActorContext,
} from '../kernel';
import {
  accessKey,
  buildGuiaRemision,
  CARRIER_ID_TYPES,
  guiaDateProblem,
  randomNumericCode,
  rideData,
} from '../sri';
import { ambienteFor, issuingContext, type Ambiente, type IssuingContext } from '../tenancy';
import {
  consumeQuota,
  findIdempotent,
  issued,
  nameValue,
  numberOf,
  retryDeadline,
  text,
  validateAndSign,
  type IssueDeps,
  type IssuedDocument,
} from './compose';
import { correctDocument } from './create-invoice';
import { recordVersion } from './exchanges';
import { documentActions, documentNumber } from './queries';
import { takeSequential } from './sequence';

// FR-SAL-9: a guía de remisión moves goods and states no money. Its carrier, plate, dates and
// recipients live in the signed XML; the row keeps the first recipient as its "buyer" so the
// list and search work, zero totals, and one line per item moved.

const date = z.iso.date();
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

const recipient = z.object({
  identification: text(20),
  name: text(300),
  address: text(300),
  reason: text(300),
  customsDocument: optional(z.string().regex(/^[0-9]{13}$/)),
  destinationEstablishment: optional(z.string().regex(/^[0-9]{3}$/)),
  route: optional(text(300)),
  // The document that supports the move, usually the invoice.
  support: optional(
    z.object({
      number: z.string().regex(/^[0-9]{3}-[0-9]{3}-[0-9]{9}$/),
      authorization: optional(z.string().regex(/^[0-9]{10,49}$/)),
      issueDate: date,
    }),
  ),
  lines: z
    .array(
      z.object({
        code: optional(text(25)),
        auxiliaryCode: optional(text(25)),
        name: text(300),
        quantity: preciseInput.refine((value) => Number(value) > 0, 'Must be more than 0'),
        additionalDetails: z.array(nameValue).max(3).default([]),
      }),
    )
    .min(1)
    .max(200),
});

export const guideInput = z.object({
  issuePointId: z.uuid(),
  // The invoice it moves goods for, when there is one.
  originId: optional(z.uuid()),
  departureAddress: text(300),
  carrier: z.object({
    idType: z.enum(CARRIER_ID_TYPES),
    identification: text(20),
    name: text(300),
    rise: optional(text(40)),
  }),
  transportStart: date,
  transportEnd: date,
  plate: text(20),
  recipients: z.array(recipient).min(1).max(50),
  // The provider RUC takes the fifteenth place.
  additionalInfo: z.array(nameValue).max(14).default([]),
  idempotencyKey: z.string().trim().min(1).max(100).nullable().default(null),
});
export type GuideInput = z.input<typeof guideInput>;

export const guideCorrectionInput = guideInput.omit({
  issuePointId: true,
  originId: true,
  idempotencyKey: true,
});
export type GuideCorrectionInput = z.input<typeof guideCorrectionInput>;

export type GuideContent = z.output<typeof guideCorrectionInput>;
type Content = GuideContent;

// Tabla 6 by length, for the snapshot only: the XML carries no type for a recipient.
const idTypeOf = (identification: string): '04' | '05' | '06' =>
  /^[0-9]{13}$/.test(identification) ? '04' : /^[0-9]{10}$/.test(identification) ? '05' : '06';

// SRI error 82, said before signing: the transport starts on or after the day it is sent.
// SRI reads the guía's emission date from the transport start (error 58 otherwise), so the
// access key and the row carry that date; `today` is the day it is sent.
function checkDates(today: string, input: Content) {
  const problem = guiaDateProblem(today, input.transportStart, input.transportEnd);
  if (problem === 'START_BEFORE_ISSUE')
    throw new DomainError(
      'TRANSPORT_START_BEFORE_ISSUE',
      'The transport can not start before the guía is issued',
      { issueDate: today },
    );
  if (problem === 'END_BEFORE_START')
    throw new DomainError(
      'TRANSPORT_END_BEFORE_START',
      'The transport can not end before it starts',
    );
}

// A guía goes with an invoice that exists and was not voided.
async function checkOrigin(ctx: ActorContext, tx: Tx, originId: string | null) {
  if (!originId) return null;
  const [origin] = await tx.db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, originId), eq(schema.documents.tenantId, ctx.tenantId)));
  if (!origin || (ctx.issuePointIds !== null && !ctx.issuePointIds.includes(origin.issuePointId)))
    throw new DomainError('NOT_FOUND', 'Document not found');
  if (origin.documentType !== '01')
    throw new DomainError('ORIGIN_NOT_INVOICE', 'A guía goes with an invoice');
  if (origin.status === 'VOIDED')
    throw new DomainError('ORIGIN_NOT_AUTHORIZED', 'A voided invoice has no guía', {
      status: origin.status,
    });
  return origin;
}

async function composeGuide(
  ctx: ActorContext,
  input: Content,
  issuer: IssuingContext,
  numbering: { sequential: number; issueDate: string; ambiente: Ambiente; accessKey: string },
  deps: IssueDeps,
) {
  checkDates(ecuadorDate(ctx.clock.now()), input);
  const { xml } = buildGuiaRemision({
    ambiente: numbering.ambiente,
    accessKey: numbering.accessKey,
    establishment: issuer.branchCode,
    issuePoint: issuer.pointCode,
    sequential: numbering.sequential,
    issuer,
    departureAddress: input.departureAddress,
    carrier: input.carrier,
    transportStart: input.transportStart,
    transportEnd: input.transportEnd,
    plate: input.plate,
    recipients: input.recipients.map((one) => ({
      ...one,
      support: one.support ? { ...one.support, documentType: '01' } : null,
    })),
    additionalInfo: input.additionalInfo,
    providerRuc: deps.providerRuc,
  });
  const signedXml = await validateAndSign(ctx, xml, '06', issuer, deps);

  const first = input.recipients[0]!;
  const columns = {
    issueDate: numbering.issueDate,
    accessKey: numbering.accessKey,
    buyerIdType: idTypeOf(first.identification),
    buyerIdentification: first.identification,
    buyerName: first.name,
    buyerAddress: first.address,
    buyerEmail: null,
    subtotal: '0.00',
    discount: '0.00',
    taxTotals: [],
    total: '0.00',
    signedXml,
    retryUntil: retryDeadline(numbering.issueDate),
  };
  const insertParts = async (tx: Tx, documentId: string, revision: number) => {
    const goods = input.recipients.flatMap((one) => one.lines);
    await tx.db.insert(schema.documentLines).values(
      goods.map((line, index) => ({
        tenantId: ctx.tenantId,
        documentId,
        revision,
        position: index + 1,
        code: line.code ?? '',
        auxiliaryCode: line.auxiliaryCode,
        name: line.name,
        quantity: line.quantity,
        unitPrice: '0',
        discount: '0.00',
        ivaRateCode: '0',
        ivaPercent: '0',
        base: '0.00',
        iva: '0.00',
        additionalDetails: line.additionalDetails,
      })),
    );
  };
  return { columns, insertParts };
}

// FR-SAL-9 in the pipeline of FR-DOC-2: idempotency, the point, quota, the sequential, the key,
// the XML, the XSD, the signature, the rows and the send job, in one transaction.
export async function createGuide(
  ctx: ActorContext,
  db: Database,
  raw: GuideInput,
  deps: IssueDeps,
): Promise<IssuedDocument> {
  requirePermission(ctx, 'documents.issue');
  requireFeature(ctx, 'DOC_TYPE_06');
  const input = guideInput.parse(raw);
  const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');

  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const existing = await findIdempotent(tx, ctx, input.idempotencyKey, payloadHash);
    if (existing) return existing;

    const origin = await checkOrigin(ctx, tx, input.originId);
    const issuer = await issuingContext(ctx, tx, input.issuePointId);
    await consumeQuota(ctx, tx);
    const sequential = await takeSequential(tx.db, {
      tenantId: ctx.tenantId,
      issuePointId: input.issuePointId,
      documentType: '06',
    });
    const issueDate = input.transportStart;
    const ambiente = ambienteFor(ctx.tenantMode, deps.appEnv);
    const series = `${issuer.branchCode}${issuer.pointCode}`;
    const key = accessKey({
      issueDate,
      documentType: '06',
      ruc: issuer.ruc,
      ambiente,
      series,
      sequential,
      numericCode: randomNumericCode(),
    });
    const { columns, insertParts } = await composeGuide(
      ctx,
      input,
      issuer,
      { sequential, issueDate, ambiente, accessKey: key },
      deps,
    );

    const [document] = await tx.db
      .insert(schema.documents)
      .values({
        ...columns,
        tenantId: ctx.tenantId,
        issuePointId: input.issuePointId,
        documentType: '06',
        series,
        sequential,
        ambiente,
        relatedDocumentId: origin?.id ?? null,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        createdBy: ctx.userId ?? null,
      })
      .returning();
    await insertParts(tx, document!.id, 1);
    await recordVersion(tx, {
      tenantId: ctx.tenantId,
      documentId: document!.id,
      reason: 'CREATED',
      revision: 1,
      accessKey: document!.accessKey,
      issueDate: document!.issueDate,
      signedXml: document!.signedXml!,
      actorUserId: ctx.userId ?? null,
    });
    await tx.db.insert(schema.documentEvents).values({
      tenantId: ctx.tenantId,
      documentId: document!.id,
      type: 'CREATED',
      toStatus: 'SIGNED',
      details: origin
        ? { originId: origin.id, origin: numberOf(origin.series, origin.sequential) }
        : {},
      actorUserId: ctx.userId ?? null,
    });
    // Same transaction: a rolled-back guía never gets sent (CLAUDE.md rule 10).
    await deps.jobs.enqueue(tx, 'sri.send', { tenantId: ctx.tenantId, documentId: document!.id });
    return issued(document!, true);
  });
}

// FR-DOC-7 for a guía: the same row and sequential. Its date is the transport start, so a
// correction keeps the key unless the start moves; it must still not be in the past (error 82).
export async function correctGuide(
  ctx: ActorContext,
  db: Database,
  documentId: string,
  raw: GuideCorrectionInput,
  deps: IssueDeps,
): Promise<IssuedDocument> {
  const input = guideCorrectionInput.parse(raw);
  return correctDocument(
    ctx,
    db,
    documentId,
    '06',
    async (tx, row, issuer, numbering) => {
      const parts = await composeGuide(ctx, input, issuer, numbering, deps);
      return { ...parts, insertParts: (id, revision) => parts.insertParts(tx, id, revision) };
    },
    deps,
    { issueDate: input.transportStart },
  );
}

export type GuideDraft = {
  id: string;
  number: string;
  issuePointId: string;
  issuePoint: string;
  originId: string | null;
  content: GuideContent;
};

// FR-DOC-7: what the correction form starts from: the guía as last signed.
export async function guideDraft(
  ctx: ActorContext,
  db: Database,
  documentId: string,
): Promise<GuideDraft> {
  requirePermission(ctx, 'documents.issue');
  const id = z.uuid().parse(documentId);
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [row] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (
      !row ||
      row.documentType !== '06' ||
      !row.signedXml ||
      (ctx.issuePointIds !== null && !ctx.issuePointIds.includes(row.issuePointId))
    )
      throw new DomainError('NOT_FOUND', 'Document not found');
    if (!documentActions(ctx, row).correct)
      throw new DomainError('NOT_CORRECTABLE', 'This document can not be corrected now');
    const data = rideData(row.signedXml);
    if (!data.transport) throw new Error('A guía without its transport');
    const added = new Set(['RUC Proveedor']);
    return {
      id: row.id,
      number: documentNumber(row.series, row.sequential),
      issuePointId: row.issuePointId,
      issuePoint: `${row.series.slice(0, 3)}-${row.series.slice(3)}`,
      originId: row.relatedDocumentId,
      content: {
        departureAddress: data.transport.departureAddress,
        carrier: {
          ...data.transport.carrier,
          idType: data.transport.carrier.idType as (typeof CARRIER_ID_TYPES)[number],
        },
        transportStart: data.transport.start,
        transportEnd: data.transport.end,
        plate: data.transport.plate,
        recipients: data.transport.recipients,
        additionalInfo: data.additionalInfo.filter((field) => !added.has(field.name)),
      },
    };
  });
}

export type GuideInvoice = {
  id: string;
  number: string;
  issueDate: string;
  buyerName: string;
  buyerIdentification: string;
};

// The latest authorized invoices, for the form's search: picking one fills the recipient.
export async function guideInvoices(ctx: ActorContext, db: Database): Promise<GuideInvoice[]> {
  requirePermission(ctx, 'documents.issue');
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const rows = await tx
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.documentType, '01'),
          eq(schema.documents.status, 'AUTHORIZED'),
          ctx.issuePointIds !== null
            ? inArray(schema.documents.issuePointId, ctx.issuePointIds)
            : undefined,
        ),
      )
      .orderBy(desc(schema.documents.issueDate), desc(schema.documents.sequential))
      .limit(100);
    return rows.map((row) => ({
      id: row.id,
      number: documentNumber(row.series, row.sequential),
      issueDate: row.issueDate,
      buyerName: row.buyerName,
      buyerIdentification: row.buyerIdentification,
    }));
  });
}

// What the guía form starts from when it is made for an invoice: its buyer and goods.
export async function guideFromInvoice(
  ctx: ActorContext,
  db: Database,
  invoiceId: string,
): Promise<{
  originId: string;
  number: string;
  recipient: GuideContent['recipients'][number];
}> {
  requirePermission(ctx, 'documents.issue');
  const id = z.uuid().parse(invoiceId);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const origin = await checkOrigin(ctx, tx, id);
    const lines = await tx.db
      .select()
      .from(schema.documentLines)
      .where(
        and(
          eq(schema.documentLines.documentId, origin!.id),
          eq(schema.documentLines.revision, origin!.revision),
        ),
      )
      .orderBy(asc(schema.documentLines.position));
    return {
      originId: origin!.id,
      number: documentNumber(origin!.series, origin!.sequential),
      recipient: {
        identification: origin!.buyerIdentification,
        name: origin!.buyerName,
        address: origin!.buyerAddress ?? '',
        reason: 'Venta',
        customsDocument: null,
        destinationEstablishment: null,
        route: null,
        support: {
          number: documentNumber(origin!.series, origin!.sequential),
          authorization: origin!.authorizationNumber,
          issueDate: origin!.issueDate,
        },
        lines: lines.map((line) => ({
          code: line.code || null,
          auxiliaryCode: line.auxiliaryCode,
          name: line.name,
          quantity: line.quantity,
          additionalDetails: [],
        })),
      },
    };
  });
}
