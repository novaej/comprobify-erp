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
import { DomainError, requirePermission, type ActorContext } from '../kernel';
import { authorizedXmlFile, SELECTABLE_IVA_RATES, SRI_IVA_RATES } from '../sri';
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

// What the invoice form offers: the points this user can issue facturas from now.
export async function issuingOptions(ctx: ActorContext, db: Database): Promise<IssuingOptions> {
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
          eq(issuePointDocumentTypes.documentType, '01'),
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
};

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
    const [lines, payments, events, reissues] = await Promise.all([
      tx.select().from(documentLines).where(current).orderBy(asc(documentLines.position)),
      tx
        .select()
        .from(documentPayments)
        .where(
          and(eq(documentPayments.documentId, id), eq(documentPayments.revision, row.revision)),
        )
        .orderBy(asc(documentPayments.position)),
      // The raw SRI answers stay out: kept for support, never shown (FR-DOC-13).
      tx
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
        .orderBy(asc(documentEvents.occurredAt), asc(documentEvents.id)),
      tx
        .select()
        .from(documentReissues)
        .where(eq(documentReissues.documentId, id))
        .orderBy(asc(documentReissues.createdAt)),
    ]);
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
