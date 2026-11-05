import { createHash } from 'node:crypto';
import { and, eq, gte, schema, sql, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import type { KeyCipher } from '../certificates';
import type { Jobs } from '../jobs';
import {
  amountInput,
  Dec,
  DomainError,
  ecuadorDate,
  endOfEcuadorDay,
  limitOf,
  preciseInput,
  requirePermission,
  startOfEcuadorMonth,
  toSriAmount,
  type ActorContext,
} from '../kernel';
import { buyerChangesInput, buyerForDocument, updateBuyerDetails } from '../parties';
import {
  accessKey,
  buildFactura,
  CONSUMER_FINAL_ID,
  CONSUMER_FINAL_ID_TYPE,
  lineAmounts,
  randomNumericCode,
  SELECTABLE_IVA_RATES,
  signXml,
  SRI_PAYMENT_METHODS,
  SRI_TERM_UNITS,
  validateXml,
} from '../sri';
import {
  ambienteFor,
  issuingContext,
  type Ambiente,
  type AppEnv,
  type IssuingContext,
} from '../tenancy';
import { recordVersion } from './exchanges';
import { locked, transition } from './sending';
import { takeSequential } from './sequence';

// SRI's text fields refuse newlines and tabs (FR-DOC-9); lengths are the XSD's.
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\n\r\t]*$/);
const nameValue = z.object({ name: text(300), value: text(300) });

export const invoiceInput = z.object({
  issuePointId: z.uuid(),
  // Null is consumidor final.
  clientId: z.uuid().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.uuid().nullable().default(null),
        code: text(25),
        auxiliaryCode: text(25).nullable().default(null),
        name: text(300),
        unit: text(50).nullable().default(null),
        quantity: preciseInput.refine((value) => new Dec(value).gt(0), 'Must be more than 0'),
        unitPrice: preciseInput,
        discount: amountInput.default('0'),
        ivaRateCode: z.enum(SELECTABLE_IVA_RATES as [string, ...string[]]),
        additionalDetails: z.array(nameValue).max(3).default([]),
      }),
    )
    .min(1)
    .max(500),
  payments: z
    .array(
      z.object({
        method: z.enum(SRI_PAYMENT_METHODS),
        amount: amountInput,
        term: z.int().min(0).max(9999).nullable().default(null),
        termUnit: z.enum(SRI_TERM_UNITS).nullable().default(null),
      }),
    )
    .min(1)
    .max(10),
  additionalInfo: z.array(nameValue).max(10).default([]),
  // Edits to the client made in the form, saved with the invoice (FR-MD-2).
  clientChanges: buyerChangesInput.nullable().default(null),
  // FR-DOC-2: the same key and payload return the same document.
  idempotencyKey: z.string().trim().min(1).max(100).nullable().default(null),
});
export type InvoiceInput = z.input<typeof invoiceInput>;

export type IssueDeps = {
  jobs: Pick<Jobs, 'enqueue'>;
  keyCipher: KeyCipher;
  appEnv: AppEnv;
  // "RUC Proveedor" (ADR-013); null leaves it out.
  providerRuc: string | null;
  // FR-DOC-9: the most a consumidor final invoice may total.
  consumerFinalMaxAmount: string;
};

export type IssuedDocument = {
  id: string;
  number: string;
  sequential: number;
  accessKey: string;
  issueDate: string;
  total: string;
  status: string;
  // False when an idempotent retry returned the existing document.
  created: boolean;
};

// FR-DOC-9: SRI refuses a document over 320 KB.
const MAX_XML_BYTES = 320 * 1024;
const QUOTA_FEATURE = 'DOCUMENT_QUOTA';

const lock = (tx: Tx, key: string) =>
  tx.executeSql('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);

const numberOf = (series: string, sequential: number) =>
  `${series.slice(0, 3)}-${series.slice(3)}-${String(sequential).padStart(9, '0')}`;

const issued = (row: typeof schema.documents.$inferSelect, created: boolean): IssuedDocument => ({
  id: row.id,
  number: numberOf(row.series, row.sequential),
  sequential: row.sequential,
  accessKey: row.accessKey,
  issueDate: row.issueDate,
  total: row.total,
  status: row.status,
  created,
});

// Until billing periods exist (Milestone 8) a quota counts the Ecuador calendar month.
// The twin and a company still in test never use quota (FR-ONB-6a, FR-BILL-7).
async function consumeQuota(ctx: ActorContext, tx: Tx) {
  if (ctx.tenantMode !== 'PRODUCTION') return;
  const limit = limitOf(ctx.entitlements, QUOTA_FEATURE);
  if (limit === null) return;
  await lock(tx, `quota:${ctx.tenantId}`);
  const [row] = await tx.db
    .select({ used: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        gte(schema.documents.createdAt, startOfEcuadorMonth(ctx.clock.now())),
      ),
    );
  if (row!.used >= limit)
    throw new DomainError('QUOTA_EXCEEDED', 'The document quota for this period is used up', {
      limit,
    });
}

type ParsedInvoice = z.output<typeof invoiceInput>;
type Content = Pick<
  ParsedInvoice,
  'clientId' | 'clientChanges' | 'lines' | 'payments' | 'additionalInfo'
>;

// What a creation and a correction share: the buyer, the FR-DOC-9 checks, the XML in the
// XSD's order, the XSD check, the signature, and the rows to store. The caller decides
// the number, date and key.
async function composeInvoice(
  ctx: ActorContext,
  tx: Tx,
  input: Content,
  issuer: IssuingContext,
  numbering: { sequential: number; issueDate: string; ambiente: Ambiente; accessKey: string },
  deps: IssueDeps,
) {
  input.lines.forEach((line, index) => {
    if (new Dec(line.quantity).mul(line.unitPrice).lt(line.discount))
      throw new DomainError('LINE_DISCOUNT_TOO_LARGE', 'A discount exceeds its line', {
        line: index + 1,
      });
  });

  if (input.clientId && input.clientChanges)
    await updateBuyerDetails(ctx, tx, input.clientId, input.clientChanges);
  const client = input.clientId ? await buyerForDocument(ctx, tx, input.clientId) : null;
  const buyer = client
    ? {
        idType: client.idType,
        identification: client.identification,
        name: client.name,
        address: client.address,
        email: client.emails.length > 0 ? client.emails.join(',') : null,
      }
    : {
        idType: CONSUMER_FINAL_ID_TYPE,
        identification: CONSUMER_FINAL_ID,
        name: 'CONSUMIDOR FINAL',
        address: null,
        email: null,
      };

  const { xml, totals } = buildFactura({
    ambiente: numbering.ambiente,
    accessKey: numbering.accessKey,
    establishment: issuer.branchCode,
    issuePoint: issuer.pointCode,
    sequential: numbering.sequential,
    issueDate: numbering.issueDate,
    issuer,
    buyer,
    lines: input.lines,
    payments: input.payments,
    additionalInfo: input.additionalInfo,
    providerRuc: deps.providerRuc,
  });

  if (client === null && totals.total.gt(deps.consumerFinalMaxAmount))
    throw new DomainError(
      'CONSUMER_FINAL_LIMIT',
      'A consumidor final invoice can not exceed the limit',
      { limit: deps.consumerFinalMaxAmount },
    );
  const paid = input.payments.reduce((sum, payment) => sum.add(payment.amount), new Dec(0));
  if (!paid.eq(totals.total))
    throw new DomainError('PAYMENTS_TOTAL_MISMATCH', 'The payments must add up to the total', {
      total: toSriAmount(totals.total),
      paid: toSriAmount(paid),
    });

  // SRI rule 8: never sign what the XSD refuses.
  const check = await validateXml(xml, '01');
  if (!check.valid)
    throw new DomainError('XML_INVALID', 'The document does not match the SRI schema', {
      errors: check.errors,
    });
  const signedXml = signXml(
    xml,
    {
      privateKeyPem: deps.keyCipher.decrypt(issuer.certificate.encryptedPrivateKey),
      certificatePem: issuer.certificate.certificatePem,
    },
    ctx.clock.now(),
  );
  if (Buffer.byteLength(signedXml, 'utf8') > MAX_XML_BYTES)
    throw new DomainError('DOCUMENT_TOO_LARGE', 'The document is larger than SRI accepts');

  const columns = {
    accessKey: numbering.accessKey,
    issueDate: numbering.issueDate,
    clientId: input.clientId,
    buyerIdType: buyer.idType as typeof schema.documents.$inferInsert.buyerIdType,
    buyerIdentification: buyer.identification,
    buyerName: buyer.name,
    buyerAddress: buyer.address,
    buyerEmail: buyer.email,
    subtotal: toSriAmount(totals.subtotal),
    discount: toSriAmount(totals.discount),
    taxTotals: totals.taxes.map((tax) => ({
      taxCode: tax.taxCode,
      rateCode: tax.rateCode,
      percent: tax.percent.toString(),
      base: toSriAmount(tax.base),
      value: toSriAmount(tax.value),
    })),
    total: toSriAmount(totals.total),
    signedXml,
    retryUntil: endOfEcuadorDay(numbering.issueDate),
  };

  // Lines and payments are never updated: each revision adds its own.
  async function insertParts(documentId: string, revision: number) {
    await tx.db.insert(schema.documentLines).values(
      input.lines.map((line, index) => {
        // The same rounding the XML used (ADR-012).
        const amounts = lineAmounts(line);
        return {
          tenantId: ctx.tenantId,
          documentId,
          revision,
          position: index + 1,
          productId: line.productId,
          code: line.code,
          auxiliaryCode: line.auxiliaryCode,
          name: line.name,
          unit: line.unit,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: toSriAmount(new Dec(line.discount)),
          ivaRateCode: line.ivaRateCode,
          ivaPercent: amounts.ivaPercent.toString(),
          base: toSriAmount(amounts.base),
          iva: toSriAmount(amounts.iva),
          additionalDetails: line.additionalDetails,
        };
      }),
    );
    await tx.db.insert(schema.documentPayments).values(
      input.payments.map((payment, index) => ({
        tenantId: ctx.tenantId,
        documentId,
        revision,
        position: index + 1,
        method: payment.method,
        amount: payment.amount,
        term: payment.term,
        termUnit: payment.termUnit,
      })),
    );
  }

  return { columns, insertParts };
}

// FR-DOC-2, in one transaction: idempotency, issue point, quota, the sequential, the
// access key, the XML, the XSD, the signature, the rows, and the send job. Anything
// that fails rolls the number back.
export async function createInvoice(
  ctx: ActorContext,
  db: Database,
  raw: InvoiceInput,
  deps: IssueDeps,
): Promise<IssuedDocument> {
  requirePermission(ctx, 'documents.issue');
  const input = invoiceInput.parse(raw);
  const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const now = ctx.clock.now();

  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const { documents } = schema;
    if (input.idempotencyKey) {
      // Two requests with one key wait for each other here, so only one creates.
      await lock(tx, `idempotency:${ctx.tenantId}:${input.idempotencyKey}`);
      const [existing] = await tx.db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, ctx.tenantId),
            eq(documents.idempotencyKey, input.idempotencyKey),
          ),
        );
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new DomainError(
            'IDEMPOTENCY_CONFLICT',
            'This idempotency key was used for a different document',
          );
        return issued(existing, false);
      }
    }

    const issuer = await issuingContext(ctx, tx, input.issuePointId);
    await consumeQuota(ctx, tx);
    const sequential = await takeSequential(tx.db, {
      tenantId: ctx.tenantId,
      issuePointId: input.issuePointId,
      documentType: '01',
    });
    const issueDate = ecuadorDate(now);
    const ambiente = ambienteFor(ctx.tenantMode, deps.appEnv);
    const series = `${issuer.branchCode}${issuer.pointCode}`;
    const key = accessKey({
      issueDate,
      documentType: '01',
      ruc: issuer.ruc,
      ambiente,
      series,
      sequential,
      numericCode: randomNumericCode(),
    });
    const { columns, insertParts } = await composeInvoice(
      ctx,
      tx,
      input,
      issuer,
      { sequential, issueDate, ambiente, accessKey: key },
      deps,
    );

    const [document] = await tx.db
      .insert(documents)
      .values({
        ...columns,
        tenantId: ctx.tenantId,
        issuePointId: input.issuePointId,
        documentType: '01',
        series,
        sequential,
        ambiente,
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
      actorUserId: ctx.userId ?? null,
    });
    // Same transaction: a rolled-back document never gets sent (CLAUDE.md rule 10).
    await deps.jobs.enqueue(tx, 'sri.send', { tenantId: ctx.tenantId, documentId: document!.id });
    return issued(document!, true);
  });
}

export const correctionInput = invoiceInput.omit({ issuePointId: true, idempotencyKey: true });
export type CorrectionInput = z.input<typeof correctionInput>;

const CORRECTABLE = ['RETURNED', 'NOT_AUTHORIZED', 'SEND_FAILED'] as const;

// FR-DOC-7: a document SRI returned or rejected, or never got, is corrected and resent as
// the same row and sequential: the same key on its issue day, today's date and a new key
// after it (the old ones kept, as for a re-issue). A SEND_FAILED one only once SRI was
// asked and didn't have it: before that, it may still be at SRI.
export async function correctInvoice(
  ctx: ActorContext,
  db: Database,
  documentId: string,
  raw: CorrectionInput,
  deps: IssueDeps,
): Promise<IssuedDocument> {
  requirePermission(ctx, 'documents.issue');
  const id = z.uuid().parse(documentId);
  const input = correctionInput.parse(raw);
  const now = ctx.clock.now();

  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    const row = await locked(tx, { tenantId: ctx.tenantId, documentId: id });
    if (!row) throw new DomainError('NOT_FOUND', 'Document not found');
    if (!(CORRECTABLE as readonly string[]).includes(row.status))
      throw new DomainError(
        'NOT_CORRECTABLE',
        'Only a returned, rejected or unsent document can be corrected',
        {
          status: row.status,
        },
      );
    if (row.status === 'SEND_FAILED' && (!row.deadlineCheckedAt || row.sriUnreachable))
      throw new DomainError(
        'MAY_BE_AT_SRI',
        'SRI has not yet confirmed it lacks this document; it can not be corrected yet',
      );

    const issuer = await issuingContext(ctx, tx, row.issuePointId);
    const today = ecuadorDate(now);
    const key =
      row.issueDate === today
        ? row.accessKey
        : accessKey({
            issueDate: today,
            documentType: row.documentType,
            ruc: issuer.ruc,
            ambiente: row.ambiente,
            series: row.series,
            sequential: row.sequential,
            numericCode: randomNumericCode(),
          });
    const { columns, insertParts } = await composeInvoice(
      ctx,
      tx,
      input,
      issuer,
      { sequential: row.sequential, issueDate: today, ambiente: row.ambiente, accessKey: key },
      deps,
    );

    if (key !== row.accessKey)
      await tx.db.insert(schema.documentReissues).values({
        tenantId: row.tenantId,
        documentId: row.id,
        reason: 'CORRECTED',
        previousAccessKey: row.accessKey,
        previousIssueDate: row.issueDate,
        previousSignedXml: row.signedXml!,
        accessKey: key,
        issueDate: today,
        actorUserId: ctx.userId ?? null,
      });
    const revision = row.revision + 1;
    const updated = await transition(
      tx,
      row,
      'SIGNED',
      {
        ...columns,
        revision,
        sendAttempts: 0,
        deadlineCheckedAt: null,
        sriUnreachable: false,
        receivedAt: null,
        authorizationChecks: 0,
        overdueAlertedAt: null,
      },
      {
        type: 'CORRECTED',
        details: { revision, previousAccessKey: key === row.accessKey ? null : row.accessKey },
        actorUserId: ctx.userId ?? null,
      },
    );
    await insertParts(row.id, revision);
    await recordVersion(tx, {
      tenantId: row.tenantId,
      documentId: row.id,
      reason: 'CORRECTED',
      revision,
      accessKey: updated.accessKey,
      issueDate: updated.issueDate,
      signedXml: updated.signedXml!,
      actorUserId: ctx.userId ?? null,
    });
    await deps.jobs.enqueue(tx, 'sri.send', { tenantId: ctx.tenantId, documentId: row.id });
    return issued(updated, false);
  });
}
