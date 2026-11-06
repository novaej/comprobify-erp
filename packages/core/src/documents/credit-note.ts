import { createHash } from 'node:crypto';
import { and, asc, eq, ne, notInArray, schema, sql, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import {
  amountInput,
  Dec,
  DomainError,
  ecuadorDate,
  preciseInput,
  requireFeature,
  requirePermission,
  toSriAmount,
  type ActorContext,
} from '../kernel';
import {
  accessKey,
  buildNotaCredito,
  CONSUMER_FINAL_ID,
  lineAmounts,
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
  totalsColumns,
  validateAndSign,
  type IssueDeps,
  type IssuedDocument,
} from './compose';
import { correctDocument } from './create-invoice';
import { recordVersion } from './exchanges';
import { documentActions, documentNumber } from './queries';
import { locked } from './sending';
import { takeSequential } from './sequence';

type Row = typeof schema.documents.$inferSelect;

export const creditNoteInput = z.object({
  issuePointId: z.uuid(),
  // The invoice it credits.
  originId: z.uuid(),
  // Printed as motivo.
  reason: text(300),
  lines: z
    .array(
      z.object({
        // The position of the invoice line it credits.
        sourcePosition: z.int().min(1),
        quantity: preciseInput.refine((value) => new Dec(value).gt(0), 'Must be more than 0'),
        // Null credits at the invoice line's own price.
        unitPrice: preciseInput.nullable().default(null),
        discount: amountInput.default('0'),
        additionalDetails: z.array(nameValue).max(3).default([]),
      }),
    )
    .min(1)
    .max(500),
  additionalInfo: z.array(nameValue).max(10).default([]),
  idempotencyKey: z.string().trim().min(1).max(100).nullable().default(null),
});
export type CreditNoteInput = z.input<typeof creditNoteInput>;

export const creditNoteCorrectionInput = creditNoteInput.omit({
  issuePointId: true,
  originId: true,
  idempotencyKey: true,
});
export type CreditNoteCorrectionInput = z.input<typeof creditNoteCorrectionInput>;

// A credit note that SRI returned or rejected holds nothing: it is corrected, and then has to fit
// what is left. Anything else, even one still in flight, holds its share (FR-SAL-8).
const RELEASED = ['RETURNED', 'NOT_AUTHORIZED', 'VOIDED'] as const;

export type CreditBalanceLine = {
  position: number;
  code: string;
  name: string;
  unit: string | null;
  ivaRateCode: string;
  unitPrice: string;
  quantity: string;
  base: string;
  remainingQuantity: string;
  remainingBase: string;
};

type Balance = { line: typeof schema.documentLines.$inferSelect; quantity: Dec; base: Dec };

// What each line of the invoice has left to credit. `except` is the credit note being corrected:
// its own current content isn't held against it.
async function balanceOf(tx: Tx, origin: Row, except: string | null): Promise<Balance[]> {
  const { documents, documentLines } = schema;
  const lines = await tx.db
    .select()
    .from(documentLines)
    .where(
      and(eq(documentLines.documentId, origin.id), eq(documentLines.revision, origin.revision)),
    )
    .orderBy(asc(documentLines.position));
  const held = await tx.db
    .select({
      position: documentLines.sourcePosition,
      quantity: sql<string>`sum(${documentLines.quantity})`,
      base: sql<string>`sum(${documentLines.base})`,
    })
    .from(documentLines)
    .innerJoin(
      documents,
      and(
        eq(documents.id, documentLines.documentId),
        eq(documents.revision, documentLines.revision),
      ),
    )
    .where(
      and(
        eq(documents.relatedDocumentId, origin.id),
        eq(documents.documentType, '04'),
        notInArray(documents.status, [...RELEASED]),
        except ? ne(documents.id, except) : undefined,
      ),
    )
    .groupBy(documentLines.sourcePosition);
  const heldBy = new Map(held.map((row) => [row.position, row]));
  return lines.map((line) => {
    const used = heldBy.get(line.position);
    return {
      line,
      quantity: new Dec(line.quantity).sub(used?.quantity ?? 0),
      base: new Dec(line.base).sub(used?.base ?? 0),
    };
  });
}

// An invoice can be credited when SRI authorized it, to a buyer who is identified (FR-DOC-9),
// within the issue points the user may see.
function checkOrigin(ctx: ActorContext, origin: Row | undefined): asserts origin is Row {
  if (!origin || (ctx.issuePointIds !== null && !ctx.issuePointIds.includes(origin.issuePointId)))
    throw new DomainError('NOT_FOUND', 'Document not found');
  if (origin.documentType !== '01')
    throw new DomainError('ORIGIN_NOT_INVOICE', 'Only an invoice can be credited');
  if (origin.status !== 'AUTHORIZED')
    throw new DomainError('ORIGIN_NOT_AUTHORIZED', 'Only an authorized invoice can be credited', {
      status: origin.status,
    });
  if (origin.buyerIdentification === CONSUMER_FINAL_ID)
    throw new DomainError(
      'CREDIT_NOTE_NEEDS_BUYER',
      'A consumidor final invoice can not be credited',
    );
}

// What is left to credit on each line of an authorized invoice, for the credit note form.
export async function creditBalance(
  ctx: ActorContext,
  db: Database,
  originId: string,
): Promise<CreditBalanceLine[]> {
  requirePermission(ctx, 'documents.read');
  const id = z.uuid().parse(originId);
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const [origin] = await tx.db.select().from(schema.documents).where(eq(schema.documents.id, id));
    checkOrigin(ctx, origin);
    return (await balanceOf(tx, origin, null)).map(({ line, quantity, base }) => ({
      position: line.position,
      code: line.code,
      name: line.name,
      unit: line.unit,
      ivaRateCode: line.ivaRateCode,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      base: line.base,
      remainingQuantity: quantity.toString(),
      remainingBase: toSriAmount(base),
    }));
  });
}

type Content = z.output<typeof creditNoteCorrectionInput>;

// What a creation and a correction share: the lines held to the invoice's balance, the XML in
// the XSD's order, the XSD check, the signature, and the rows to store.
async function composeCreditNote(
  ctx: ActorContext,
  tx: Tx,
  origin: Row,
  input: Content,
  issuer: IssuingContext,
  numbering: { sequential: number; issueDate: string; ambiente: Ambiente; accessKey: string },
  deps: IssueDeps,
  except: string | null,
) {
  const balance = await balanceOf(tx, origin, except);
  const byPosition = new Map(balance.map((entry) => [entry.line.position, entry]));

  const spent = new Map<number, { quantity: Dec; base: Dec }>();
  const lines = input.lines.map((line, index) => {
    const source = byPosition.get(line.sourcePosition);
    if (!source)
      throw new DomainError('CREDIT_LINE_UNKNOWN', 'The invoice has no such line', {
        line: index + 1,
      });
    const unitPrice = line.unitPrice ?? source.line.unitPrice;
    if (new Dec(line.quantity).mul(unitPrice).lt(line.discount))
      throw new DomainError('LINE_DISCOUNT_TOO_LARGE', 'A discount exceeds its line', {
        line: index + 1,
      });
    const base = lineAmounts({
      quantity: line.quantity,
      unitPrice,
      discount: line.discount,
      ivaRateCode: source.line.ivaRateCode,
    }).base;
    const before = spent.get(line.sourcePosition) ?? { quantity: new Dec(0), base: new Dec(0) };
    spent.set(line.sourcePosition, {
      quantity: before.quantity.add(line.quantity),
      base: before.base.add(base),
    });
    return { line, source: source.line, unitPrice };
  });
  // Quantity and amount are each held to what is left of the invoice line.
  for (const [position, total] of spent) {
    const left = byPosition.get(position)!;
    if (total.quantity.gt(left.quantity) || total.base.gt(left.base))
      throw new DomainError(
        'CREDIT_EXCEEDS_BALANCE',
        'A line credits more than the invoice has left',
        {
          position,
          remainingQuantity: left.quantity.toString(),
          remainingBase: toSriAmount(left.base),
        },
      );
  }

  const buyer = {
    idType: origin.buyerIdType,
    identification: origin.buyerIdentification,
    name: origin.buyerName,
    address: origin.buyerAddress,
    email: origin.buyerEmail,
  };
  const { xml, totals } = buildNotaCredito({
    ambiente: numbering.ambiente,
    accessKey: numbering.accessKey,
    establishment: issuer.branchCode,
    issuePoint: issuer.pointCode,
    sequential: numbering.sequential,
    issueDate: numbering.issueDate,
    issuer,
    buyer,
    modified: {
      documentType: origin.documentType,
      number: numberOf(origin.series, origin.sequential),
      issueDate: origin.issueDate,
    },
    reason: input.reason,
    lines: lines.map(({ line, source, unitPrice }) => ({
      code: source.code,
      auxiliaryCode: source.auxiliaryCode,
      name: source.name,
      quantity: line.quantity,
      unitPrice,
      discount: line.discount,
      ivaRateCode: source.ivaRateCode,
      additionalDetails: line.additionalDetails,
    })),
    additionalInfo: input.additionalInfo,
    providerRuc: deps.providerRuc,
  });
  const signedXml = await validateAndSign(ctx, xml, '04', issuer, deps);

  const columns = {
    accessKey: numbering.accessKey,
    issueDate: numbering.issueDate,
    clientId: origin.clientId,
    buyerIdType: origin.buyerIdType,
    buyerIdentification: origin.buyerIdentification,
    buyerName: origin.buyerName,
    buyerAddress: origin.buyerAddress,
    buyerEmail: origin.buyerEmail,
    ...totalsColumns(totals),
    signedXml,
    retryUntil: retryDeadline(numbering.issueDate),
  };

  // Lines are never updated: each revision adds its own. A credit note has no payments.
  async function insertParts(documentId: string, revision: number) {
    await tx.db.insert(schema.documentLines).values(
      lines.map(({ line, source, unitPrice }, index) => {
        const amounts = lineAmounts({
          quantity: line.quantity,
          unitPrice,
          discount: line.discount,
          ivaRateCode: source.ivaRateCode,
        });
        return {
          tenantId: ctx.tenantId,
          documentId,
          revision,
          position: index + 1,
          sourcePosition: line.sourcePosition,
          productId: source.productId,
          code: source.code,
          auxiliaryCode: source.auxiliaryCode,
          name: source.name,
          unit: source.unit,
          quantity: line.quantity,
          unitPrice,
          discount: toSriAmount(new Dec(line.discount)),
          ivaRateCode: source.ivaRateCode,
          ivaPercent: amounts.ivaPercent.toString(),
          base: toSriAmount(amounts.base),
          iva: toSriAmount(amounts.iva),
          additionalDetails: line.additionalDetails,
        };
      }),
    );
  }

  return { columns, insertParts };
}

// FR-SAL-8, in the pipeline of FR-DOC-2: the invoice is locked first, so two credit notes made at
// once can't both spend the same balance; then the same steps as an invoice.
export async function createCreditNote(
  ctx: ActorContext,
  db: Database,
  raw: CreditNoteInput,
  deps: IssueDeps,
): Promise<IssuedDocument> {
  requirePermission(ctx, 'documents.issue');
  requireFeature(ctx, 'DOC_TYPE_04');
  const input = creditNoteInput.parse(raw);
  const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const now = ctx.clock.now();

  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const existing = await findIdempotent(tx, ctx, input.idempotencyKey, payloadHash);
    if (existing) return existing;

    const origin = await locked(tx, { tenantId: ctx.tenantId, documentId: input.originId });
    checkOrigin(ctx, origin);
    const issuer = await issuingContext(ctx, tx, input.issuePointId);
    await consumeQuota(ctx, tx);
    const sequential = await takeSequential(tx.db, {
      tenantId: ctx.tenantId,
      issuePointId: input.issuePointId,
      documentType: '04',
    });
    const issueDate = ecuadorDate(now);
    const ambiente = ambienteFor(ctx.tenantMode, deps.appEnv);
    const series = `${issuer.branchCode}${issuer.pointCode}`;
    const key = accessKey({
      issueDate,
      documentType: '04',
      ruc: issuer.ruc,
      ambiente,
      series,
      sequential,
      numericCode: randomNumericCode(),
    });
    const { columns, insertParts } = await composeCreditNote(
      ctx,
      tx,
      origin,
      input,
      issuer,
      { sequential, issueDate, ambiente, accessKey: key },
      deps,
      null,
    );

    const [document] = await tx.db
      .insert(schema.documents)
      .values({
        ...columns,
        tenantId: ctx.tenantId,
        issuePointId: input.issuePointId,
        documentType: '04',
        series,
        sequential,
        ambiente,
        relatedDocumentId: origin.id,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        createdBy: ctx.userId ?? null,
      })
      .returning();
    await insertParts(document!.id, 1);
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
      details: { originId: origin.id, origin: numberOf(origin.series, origin.sequential) },
      actorUserId: ctx.userId ?? null,
    });
    // Same transaction: a rolled-back credit note never gets sent (CLAUDE.md rule 10).
    await deps.jobs.enqueue(tx, 'sri.send', { tenantId: ctx.tenantId, documentId: document!.id });
    return issued(document!, true);
  });
}

// FR-DOC-7 for a credit note: the same row and sequential, new content, held to the balance as
// it stands now (its old content holds nothing).
export async function correctCreditNote(
  ctx: ActorContext,
  db: Database,
  documentId: string,
  raw: CreditNoteCorrectionInput,
  deps: IssueDeps,
): Promise<IssuedDocument> {
  const input = creditNoteCorrectionInput.parse(raw);
  return correctDocument(
    ctx,
    db,
    documentId,
    '04',
    async (tx, row, issuer, numbering) => {
      const origin = await locked(tx, {
        tenantId: ctx.tenantId,
        documentId: row.relatedDocumentId!,
      });
      checkOrigin(ctx, origin);
      return composeCreditNote(ctx, tx, origin, input, issuer, numbering, deps, row.id);
    },
    deps,
  );
}

export type CreditNoteDraft = {
  id: string;
  number: string;
  issuePointId: string;
  issuePoint: string;
  originId: string;
  originNumber: string;
  reason: string;
  // Only the lines that were credited, as the form starts from them.
  lines: { sourcePosition: number; quantity: string; unitPrice: string; discount: string }[];
  additionalInfo: { name: string; value: string }[];
};

// FR-DOC-7: what the correction form starts from: the credit note as last signed.
export async function creditNoteDraft(
  ctx: ActorContext,
  db: Database,
  documentId: string,
): Promise<CreditNoteDraft> {
  requirePermission(ctx, 'documents.issue');
  const id = z.uuid().parse(documentId);
  const { documents, documentLines } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [row] = await tx.select().from(documents).where(eq(documents.id, id));
    if (
      !row ||
      row.documentType !== '04' ||
      !row.relatedDocumentId ||
      (ctx.issuePointIds !== null && !ctx.issuePointIds.includes(row.issuePointId))
    )
      throw new DomainError('NOT_FOUND', 'Document not found');
    if (!documentActions(ctx, row).correct)
      throw new DomainError('NOT_CORRECTABLE', 'This document can not be corrected now');
    const [origin] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, row.relatedDocumentId));
    const lines = await tx
      .select()
      .from(documentLines)
      .where(and(eq(documentLines.documentId, id), eq(documentLines.revision, row.revision)))
      .orderBy(asc(documentLines.position));
    const data = row.signedXml ? rideData(row.signedXml) : null;
    const added = new Set(['Email', 'RUC Proveedor']);
    return {
      id: row.id,
      number: documentNumber(row.series, row.sequential),
      issuePointId: row.issuePointId,
      issuePoint: `${row.series.slice(0, 3)}-${row.series.slice(3)}`,
      originId: row.relatedDocumentId,
      originNumber: origin ? documentNumber(origin.series, origin.sequential) : '',
      reason: data?.modification?.reason ?? '',
      lines: lines.flatMap((line) =>
        line.sourcePosition === null
          ? []
          : [
              {
                sourcePosition: line.sourcePosition,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discount: line.discount,
              },
            ],
      ),
      additionalInfo: (data?.additionalInfo ?? []).filter((field) => !added.has(field.name)),
    };
  });
}
