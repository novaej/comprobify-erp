import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  schema,
  sql,
  type Database,
  type SQL,
} from '@comprobify/db';
import { z } from 'zod';
import {
  DomainError,
  ecuadorDate,
  hasFeature,
  requirePermission,
  type ActorContext,
} from '../kernel';
import { authorizedXmlFile, CONSUMER_FINAL_ID, SELECTABLE_IVA_RATES, SRI_IVA_RATES } from '../sri';
import { rideData, type Transport } from '../sri';
import { DOCUMENT_STATUSES, type DocumentStatus } from './status';

// FR-DOC-12 reads. A user restricted to issue points sees only theirs (FR-ROLE-2).

const restricted = (ctx: ActorContext): SQL | undefined =>
  ctx.issuePointIds === null
    ? undefined
    : ctx.issuePointIds.length === 0
      ? sql`false`
      : inArray(schema.documents.issuePointId, [...ctx.issuePointIds]);

export const documentNumber = (series: string, sequential: number) =>
  `${series.slice(0, 3)}-${series.slice(3)}-${String(sequential).padStart(9, '0')}`;

export type IssuingOptions = {
  issuePoints: { id: string; code: string; branchName: string }[];
  ivaRates: { code: string; percent: string }[];
  live: boolean;
};

// What the document forms offer: the points this user can issue that type from now.
export async function issuingOptions(
  ctx: ActorContext,
  db: Database,
  documentType: '01' | '04' | '06' = '01',
): Promise<IssuingOptions> {
  requirePermission(ctx, 'documents.issue');
  const { branches, issuePoints, issuePointDocumentTypes, tenants } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const points = await tx
      .select({
        id: issuePoints.id,
        branchCode: branches.code,
        pointCode: issuePoints.code,
        branchName: branches.name,
      })
      .from(issuePoints)
      .innerJoin(branches, eq(branches.id, issuePoints.branchId))
      .innerJoin(
        issuePointDocumentTypes,
        and(
          eq(issuePointDocumentTypes.issuePointId, issuePoints.id),
          eq(issuePointDocumentTypes.documentType, documentType),
          eq(issuePointDocumentTypes.active, true),
        ),
      )
      .where(
        and(
          eq(issuePoints.active, true),
          eq(issuePoints.canIssue, true),
          eq(branches.active, true),
          ctx.issuePointIds === null
            ? undefined
            : ctx.issuePointIds.length === 0
              ? sql`false`
              : inArray(issuePoints.id, [...ctx.issuePointIds]),
        ),
      )
      .orderBy(branches.code, issuePoints.code);
    const [tenant] = await tx.select({ mode: tenants.mode, liveAt: tenants.liveAt }).from(tenants);
    return {
      issuePoints: points.map((point) => ({
        id: point.id,
        code: `${point.branchCode}-${point.pointCode}`,
        branchName: point.branchName,
      })),
      ivaRates: SRI_IVA_RATES.filter((rate) =>
        (SELECTABLE_IVA_RATES as readonly string[]).includes(rate.code),
      ).map((rate) => ({ code: rate.code, percent: rate.percent })),
      live: tenant?.mode === 'TEST' || tenant?.liveAt !== null,
    };
  });
}

export const documentFilters = z.object({
  status: z.enum(DOCUMENT_STATUSES).optional(),
  issuePointId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  // Number, buyer name or identification.
  query: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type DocumentFilters = z.input<typeof documentFilters>;

export type DocumentListRow = {
  id: string;
  number: string;
  documentType: string;
  issueDate: string;
  buyerName: string;
  buyerIdentification: string;
  total: string;
  status: DocumentStatus;
};

export const DOCUMENTS_PAGE_SIZE = 25;

export async function listDocuments(
  ctx: ActorContext,
  db: Database,
  raw: DocumentFilters = {},
): Promise<{ rows: DocumentListRow[]; total: number; page: number; pageSize: number }> {
  requirePermission(ctx, 'documents.read');
  const filters = documentFilters.parse(raw);
  const { documents } = schema;
  const query = filters.query?.replaceAll(/[\\%_]/g, (c) => `\\${c}`);
  // 001-001-000000123 or just 123 finds the sequential.
  const sequential =
    filters.query && /^[\d-]+$/.test(filters.query)
      ? Number(filters.query.split('-').at(-1))
      : null;
  const where = and(
    restricted(ctx),
    filters.status ? eq(documents.status, filters.status) : undefined,
    filters.issuePointId ? eq(documents.issuePointId, filters.issuePointId) : undefined,
    filters.from ? gte(documents.issueDate, filters.from) : undefined,
    filters.to ? lte(documents.issueDate, filters.to) : undefined,
    query
      ? or(
          ilike(documents.buyerName, `%${query}%`),
          ilike(documents.buyerIdentification, `${query}%`),
          sequential !== null && Number.isSafeInteger(sequential) && sequential > 0
            ? eq(documents.sequential, sequential)
            : undefined,
        )
      : undefined,
  );
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(documents)
      .where(where);
    const rows = await tx
      .select({
        id: documents.id,
        series: documents.series,
        sequential: documents.sequential,
        documentType: documents.documentType,
        issueDate: documents.issueDate,
        buyerName: documents.buyerName,
        buyerIdentification: documents.buyerIdentification,
        total: documents.total,
        status: documents.status,
      })
      .from(documents)
      .where(where)
      .orderBy(desc(documents.issueDate), desc(documents.sequential))
      .limit(DOCUMENTS_PAGE_SIZE)
      .offset((filters.page - 1) * DOCUMENTS_PAGE_SIZE);
    return {
      rows: rows.map(({ series, sequential: number, ...row }) => ({
        ...row,
        number: documentNumber(series, number),
      })),
      total: count!.total,
      page: filters.page,
      pageSize: DOCUMENTS_PAGE_SIZE,
    };
  });
}

// A document this one comes from or that came from it (a credit note and its invoice).
export type DocumentLink = {
  id: string;
  documentType: string;
  number: string;
  issueDate: string;
  status: DocumentStatus;
  total: string;
};

export type DocumentDetail = {
  id: string;
  number: string;
  documentType: string;
  status: DocumentStatus;
  ambiente: string;
  accessKey: string;
  issueDate: string;
  issuePoint: string;
  buyer: {
    idType: string;
    identification: string;
    name: string;
    address: string | null;
    email: string | null;
  };
  subtotal: string;
  discount: string;
  taxTotals: { rateCode: string; percent: string; base: string; value: string }[];
  total: string;
  authorizationNumber: string | null;
  authorizedAt: Date | null;
  revision: number;
  lines: {
    code: string;
    name: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    ivaRateCode: string;
    base: string;
  }[];
  payments: { method: string; amount: string; term: number | null; termUnit: string | null }[];
  events: {
    id: string;
    type: string;
    fromStatus: string | null;
    toStatus: string | null;
    details: Record<string, unknown>;
    occurredAt: Date;
  }[];
  previousKeys: { accessKey: string; issueDate: string; reason: string }[];
  // What it comes from, and what came from it, among the documents this user may see.
  origin: DocumentLink | null;
  derived: DocumentLink[];
  // A guía de remisión: the carrier, dates and recipients, read from its signed XML.
  transport: Transport | null;
  // What this user may do with it now (FR-DOC-6 to FR-DOC-8, FR-DOC-11). Core still checks
  // each when it's done; this only decides what the screen offers.
  allowed: DocumentActions;
};

export type DocumentActions = {
  correct: boolean;
  reissue: boolean;
  void: boolean;
  resend: boolean;
  // A nota de crédito from this invoice (FR-DOC-9).
  credit: boolean;
  // A guía de remisión for this invoice (FR-SAL-9).
  guide: boolean;
};

// The same rules the actions enforce: correctInvoice, requestReissue, voidDocument and
// resendDocumentEmail.
export function documentActions(
  ctx: ActorContext,
  row: Pick<
    typeof schema.documents.$inferSelect,
    | 'status'
    | 'documentType'
    | 'issueDate'
    | 'deadlineCheckedAt'
    | 'sriUnreachable'
    | 'buyerIdentification'
    | 'buyerEmail'
  >,
): DocumentActions {
  const can = (permission: string) => ctx.permissions.includes(permission);
  const today = ecuadorDate(ctx.clock.now());
  const unsentChecked =
    row.status === 'SEND_FAILED' && row.deadlineCheckedAt !== null && !row.sriUnreachable;
  return {
    correct:
      can('documents.issue') &&
      (row.status === 'RETURNED' || row.status === 'NOT_AUTHORIZED' || unsentChecked),
    // A guía has no issue date to move: its transport dates must hold, so a person corrects it.
    reissue:
      can('documents.issue') &&
      row.documentType !== '06' &&
      row.status === 'SEND_FAILED' &&
      row.issueDate < today,
    void:
      can('documents.void') &&
      hasFeature(ctx, 'DOCUMENT_VOID') &&
      row.status === 'AUTHORIZED' &&
      row.buyerIdentification !== CONSUMER_FINAL_ID,
    resend:
      can('documents.issue') &&
      hasFeature(ctx, 'BUYER_EMAIL') &&
      row.status === 'AUTHORIZED' &&
      row.buyerEmail !== null,
    credit:
      can('documents.issue') &&
      hasFeature(ctx, 'DOC_TYPE_04') &&
      row.documentType === '01' &&
      row.status === 'AUTHORIZED' &&
      row.buyerIdentification !== CONSUMER_FINAL_ID,
    guide:
      can('documents.issue') &&
      hasFeature(ctx, 'DOC_TYPE_06') &&
      row.documentType === '01' &&
      row.status !== 'VOIDED',
  };
}

export async function getDocument(
  ctx: ActorContext,
  db: Database,
  documentId: string,
): Promise<DocumentDetail> {
  requirePermission(ctx, 'documents.read');
  const id = z.uuid().parse(documentId);
  const { documents, documentLines, documentPayments, documentEvents, documentReissues } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [row] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), restricted(ctx)));
    if (!row) throw new DomainError('NOT_FOUND', 'Document not found');
    const current = and(eq(documentLines.documentId, id), eq(documentLines.revision, row.revision));
    // One connection per transaction: one query at a time.
    const lines = await tx
      .select()
      .from(documentLines)
      .where(current)
      .orderBy(asc(documentLines.position));
    const payments = await tx
      .select()
      .from(documentPayments)
      .where(and(eq(documentPayments.documentId, id), eq(documentPayments.revision, row.revision)))
      .orderBy(asc(documentPayments.position));
    // The raw SRI answers stay out: kept for support, never shown (FR-DOC-13).
    const events = await tx
      .select({
        id: documentEvents.id,
        type: documentEvents.type,
        fromStatus: documentEvents.fromStatus,
        toStatus: documentEvents.toStatus,
        details: documentEvents.details,
        occurredAt: documentEvents.occurredAt,
      })
      .from(documentEvents)
      .where(eq(documentEvents.documentId, id))
      .orderBy(asc(documentEvents.occurredAt), asc(documentEvents.id));
    const reissues = await tx
      .select()
      .from(documentReissues)
      .where(eq(documentReissues.documentId, id))
      .orderBy(asc(documentReissues.createdAt));
    const link = (other: typeof row): DocumentLink => ({
      id: other.id,
      documentType: other.documentType,
      number: documentNumber(other.series, other.sequential),
      issueDate: other.issueDate,
      status: other.status,
      total: other.total,
    });
    const [origin] = row.relatedDocumentId
      ? await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, row.relatedDocumentId), restricted(ctx)))
      : [];
    const derived = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.relatedDocumentId, id), restricted(ctx)))
      .orderBy(asc(documents.createdAt));
    return {
      id: row.id,
      number: documentNumber(row.series, row.sequential),
      documentType: row.documentType,
      status: row.status,
      ambiente: row.ambiente,
      accessKey: row.accessKey,
      issueDate: row.issueDate,
      issuePoint: `${row.series.slice(0, 3)}-${row.series.slice(3)}`,
      buyer: {
        idType: row.buyerIdType,
        identification: row.buyerIdentification,
        name: row.buyerName,
        address: row.buyerAddress,
        email: row.buyerEmail,
      },
      subtotal: row.subtotal,
      discount: row.discount,
      taxTotals: row.taxTotals.map(({ rateCode, percent, base, value }) => ({
        rateCode,
        percent,
        base,
        value,
      })),
      total: row.total,
      authorizationNumber: row.authorizationNumber,
      authorizedAt: row.authorizedAt,
      revision: row.revision,
      lines: lines.map((line) => ({
        code: line.code,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        ivaRateCode: line.ivaRateCode,
        base: line.base,
      })),
      payments: payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        term: payment.term,
        termUnit: payment.termUnit,
      })),
      events,
      previousKeys: reissues.map((reissue) => ({
        accessKey: reissue.previousAccessKey,
        issueDate: reissue.previousIssueDate,
        reason: reissue.reason,
      })),
      origin: origin ? link(origin) : null,
      derived: derived.map(link),
      transport:
        row.documentType === '06' && row.signedXml ? rideData(row.signedXml).transport : null,
      allowed: documentActions(ctx, row),
    };
  });
}

// The XML download: SRI's <autorizacion> once authorized, the signed document before.
export async function documentXml(
  ctx: ActorContext,
  db: Database,
  documentId: string,
): Promise<{ filename: string; content: string }> {
  requirePermission(ctx, 'documents.read');
  const id = z.uuid().parse(documentId);
  const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, id), restricted(ctx))),
  );
  if (!row?.signedXml) throw new DomainError('NOT_FOUND', 'Document not found');
  const authorized =
    row.authorizationXml && row.authorizationNumber && row.authorizedAt
      ? authorizedXmlFile({
          comprobante: row.authorizationXml,
          authorizationNumber: row.authorizationNumber,
          authorizedAt: row.authorizedAt,
          ambiente: row.ambiente,
        })
      : null;
  return { filename: `${row.accessKey}.xml`, content: authorized ?? row.signedXml };
}

// FR-DOC-12: everything not yet final, oldest first: what needs a person, or SRI.
export const PENDING_STATUSES = [
  'RETURNED',
  'NOT_AUTHORIZED',
  'SEND_FAILED',
  'SIGNED',
  'PENDING_SEND',
  'RECEIVED',
] as const satisfies readonly DocumentStatus[];

export async function listPending(
  ctx: ActorContext,
  db: Database,
): Promise<(DocumentListRow & { sriUnreachable: boolean; receivedAt: Date | null })[]> {
  requirePermission(ctx, 'documents.read');
  const { documents } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const rows = await tx
      .select()
      .from(documents)
      .where(and(restricted(ctx), inArray(documents.status, [...PENDING_STATUSES])))
      .orderBy(asc(documents.issueDate), asc(documents.sequential))
      .limit(500);
    return rows.map((row) => ({
      id: row.id,
      number: documentNumber(row.series, row.sequential),
      documentType: row.documentType,
      issueDate: row.issueDate,
      buyerName: row.buyerName,
      buyerIdentification: row.buyerIdentification,
      total: row.total,
      status: row.status,
      sriUnreachable: row.sriUnreachable,
      receivedAt: row.receivedAt,
    }));
  });
}

export type CorrectionDraft = {
  id: string;
  number: string;
  issuePointId: string;
  issuePoint: string;
  clientId: string | null;
  lines: {
    productId: string | null;
    code: string;
    auxiliaryCode: string | null;
    name: string;
    unit: string | null;
    quantity: string;
    unitPrice: string;
    discount: string;
    ivaRateCode: string;
  }[];
  payments: { method: string; amount: string; term: number | null; termUnit: string | null }[];
  additionalInfo: { name: string; value: string }[];
};

// FR-DOC-7: what the correction form starts from: the document as last signed.
export async function correctionDraft(
  ctx: ActorContext,
  db: Database,
  documentId: string,
): Promise<CorrectionDraft> {
  requirePermission(ctx, 'documents.issue');
  const id = z.uuid().parse(documentId);
  const { documents, documentLines, documentPayments } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const [row] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), restricted(ctx)));
    if (!row) throw new DomainError('NOT_FOUND', 'Document not found');
    if (!documentActions(ctx, row).correct)
      throw new DomainError('NOT_CORRECTABLE', 'This document can not be corrected now');
    const lines = await tx
      .select()
      .from(documentLines)
      .where(and(eq(documentLines.documentId, id), eq(documentLines.revision, row.revision)))
      .orderBy(asc(documentLines.position));
    const payments = await tx
      .select()
      .from(documentPayments)
      .where(and(eq(documentPayments.documentId, id), eq(documentPayments.revision, row.revision)))
      .orderBy(asc(documentPayments.position));
    // The fields the company typed, without the ones issuing adds again.
    const added = new Set(['Email', 'RUC Proveedor']);
    const additionalInfo = row.signedXml
      ? rideData(row.signedXml).additionalInfo.filter((field) => !added.has(field.name))
      : [];
    return {
      id: row.id,
      number: documentNumber(row.series, row.sequential),
      issuePointId: row.issuePointId,
      issuePoint: `${row.series.slice(0, 3)}-${row.series.slice(3)}`,
      clientId: row.clientId,
      lines: lines.map((line) => ({
        productId: line.productId,
        code: line.code,
        auxiliaryCode: line.auxiliaryCode,
        name: line.name,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        ivaRateCode: line.ivaRateCode,
      })),
      payments: payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        term: payment.term,
        termUnit: payment.termUnit,
      })),
      additionalInfo,
    };
  });
}
