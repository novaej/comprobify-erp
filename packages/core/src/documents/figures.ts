import {
  and,
  asc,
  desc,
  DOCUMENT_STATUSES,
  eq,
  gte,
  inArray,
  lte,
  or,
  schema,
  sql,
  type DocumentStatus,
  type Tx,
} from '@comprobify/db';

// FR-REP-1: what the dashboard shows of documents. Plain reads in the caller's tenant
// transaction; the reports module composes them.

export type SalesFigure = { total: string; count: number };

// Net sales of authorized invoices less authorized credit notes, over issue dates in a range.
// A voided invoice is not authorized, so it drops out.
export async function salesFigure(
  tx: Tx['db'],
  tenantId: string,
  from: string,
  to: string,
): Promise<SalesFigure> {
  const { documents } = schema;
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(CASE WHEN ${documents.documentType} = '04' THEN -${documents.total} ELSE ${documents.total} END), 0)::text`,
      count: sql<number>`(count(*) FILTER (WHERE ${documents.documentType} = '01'))::int`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.status, 'AUTHORIZED'),
        inArray(documents.documentType, ['01', '04']),
        gte(documents.issueDate, from),
        lte(documents.issueDate, to),
      ),
    );
  return { total: row!.total, count: row!.count };
}

// Not yet final or needing a person: these count whatever their date, since they are work to do.
const OPEN: readonly DocumentStatus[] = [
  'SIGNED',
  'PENDING_SEND',
  'RECEIVED',
  'RETURNED',
  'SEND_FAILED',
  'NOT_AUTHORIZED',
];

// Documents by status: this month's, plus any still open from before.
export async function statusCounts(
  tx: Tx['db'],
  tenantId: string,
  monthStart: string,
): Promise<Record<DocumentStatus, number>> {
  const { documents } = schema;
  const rows = await tx
    .select({ status: documents.status, count: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        or(gte(documents.issueDate, monthStart), inArray(documents.status, [...OPEN])),
      ),
    )
    .groupBy(documents.status);
  const counts = Object.fromEntries(DOCUMENT_STATUSES.map((status) => [status, 0])) as Record<
    DocumentStatus,
    number
  >;
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

export type TopProduct = { code: string; name: string; quantity: string; base: string };

// What sold the most this month, by the base of authorized invoices' lines (their current revision).
export async function topProducts(
  tx: Tx['db'],
  tenantId: string,
  monthStart: string,
  limit = 5,
): Promise<TopProduct[]> {
  const { documents, documentLines: lines } = schema;
  const base = sql<string>`sum(${lines.base})::text`;
  return tx
    .select({
      code: lines.code,
      name: lines.name,
      quantity: sql<string>`sum(${lines.quantity})::text`,
      base,
    })
    .from(lines)
    .innerJoin(
      documents,
      and(
        eq(documents.tenantId, lines.tenantId),
        eq(documents.id, lines.documentId),
        eq(documents.revision, lines.revision),
      ),
    )
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.status, 'AUTHORIZED'),
        eq(documents.documentType, '01'),
        gte(documents.issueDate, monthStart),
      ),
    )
    .groupBy(lines.code, lines.name)
    .orderBy(desc(sql`sum(${lines.base})`))
    .limit(limit);
}

// FR-REP-2: the rows of the sales, documents and tax reports. Authorized invoices count, and
// authorized credit notes take away, over issue dates in a range.
const sign = sql`CASE WHEN ${schema.documents.documentType} = '04' THEN -1 ELSE 1 END`;
const inRange = (tenantId: string, from: string, to: string) =>
  and(
    eq(schema.documents.tenantId, tenantId),
    eq(schema.documents.status, 'AUTHORIZED'),
    inArray(schema.documents.documentType, ['01', '04']),
    gte(schema.documents.issueDate, from),
    lte(schema.documents.issueDate, to),
  );

export type SalesRow = {
  key: string;
  label: string;
  invoices: number;
  base: string;
  total: string;
};

export async function salesBy(
  tx: Tx['db'],
  tenantId: string,
  from: string,
  to: string,
  by: 'day' | 'client',
): Promise<SalesRow[]> {
  const { documents } = schema;
  const key =
    by === 'day' ? sql<string>`${documents.issueDate}::text` : documents.buyerIdentification;
  const label =
    by === 'day'
      ? sql<string>`${documents.issueDate}::text`
      : sql<string>`max(${documents.buyerName})`;
  return tx
    .select({
      key,
      label,
      invoices: sql<number>`(count(*) FILTER (WHERE ${documents.documentType} = '01'))::int`,
      base: sql<string>`sum(${sign} * ${documents.subtotal})::text`,
      total: sql<string>`sum(${sign} * ${documents.total})::text`,
    })
    .from(documents)
    .where(inRange(tenantId, from, to))
    .groupBy(key)
    .orderBy(by === 'day' ? asc(key) : desc(sql`sum(${sign} * ${documents.total})`));
}

export type ProductSalesRow = {
  code: string;
  name: string;
  quantity: string;
  base: string;
  iva: string;
};

export async function salesByProduct(
  tx: Tx['db'],
  tenantId: string,
  from: string,
  to: string,
): Promise<ProductSalesRow[]> {
  const { documents, documentLines: lines } = schema;
  return tx
    .select({
      code: lines.code,
      name: lines.name,
      // A credit for an amount (a discount) takes no units back.
      quantity: sql<string>`sum(CASE WHEN ${lines.creditKind} = 'AMOUNT' THEN 0 ELSE ${sign} * ${lines.quantity} END)::text`,
      base: sql<string>`sum(${sign} * ${lines.base})::text`,
      iva: sql<string>`sum(${sign} * ${lines.iva})::text`,
    })
    .from(lines)
    .innerJoin(
      documents,
      and(
        eq(documents.tenantId, lines.tenantId),
        eq(documents.id, lines.documentId),
        eq(documents.revision, lines.revision),
      ),
    )
    .where(inRange(tenantId, from, to))
    .groupBy(lines.code, lines.name)
    .orderBy(desc(sql`sum(${sign} * ${lines.base})`));
}

export type TaxRow = { rateCode: string; percent: string; base: string; iva: string };

// IVA by rate, for the monthly declaration.
export async function taxSummary(
  tx: Tx['db'],
  tenantId: string,
  from: string,
  to: string,
): Promise<TaxRow[]> {
  const { documents, documentLines: lines } = schema;
  return tx
    .select({
      rateCode: lines.ivaRateCode,
      percent: sql<string>`${lines.ivaPercent}::text`,
      base: sql<string>`sum(${sign} * ${lines.base})::text`,
      iva: sql<string>`sum(${sign} * ${lines.iva})::text`,
    })
    .from(lines)
    .innerJoin(
      documents,
      and(
        eq(documents.tenantId, lines.tenantId),
        eq(documents.id, lines.documentId),
        eq(documents.revision, lines.revision),
      ),
    )
    .where(inRange(tenantId, from, to))
    .groupBy(lines.ivaRateCode, lines.ivaPercent)
    .orderBy(asc(lines.ivaPercent), asc(lines.ivaRateCode));
}

export type IssuedRow = {
  issueDate: string;
  documentType: string;
  series: string;
  sequential: number;
  buyerIdentification: string;
  buyerName: string;
  status: DocumentStatus;
  subtotal: string;
  total: string;
};

// Every document made in the range, whatever its status.
export async function documentsIssued(
  tx: Tx['db'],
  tenantId: string,
  from: string,
  to: string,
): Promise<IssuedRow[]> {
  const { documents } = schema;
  return tx
    .select({
      issueDate: sql<string>`${documents.issueDate}::text`,
      documentType: documents.documentType,
      series: documents.series,
      sequential: documents.sequential,
      buyerIdentification: documents.buyerIdentification,
      buyerName: documents.buyerName,
      status: documents.status,
      subtotal: documents.subtotal,
      total: documents.total,
    })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        gte(documents.issueDate, from),
        lte(documents.issueDate, to),
      ),
    )
    .orderBy(asc(documents.issueDate), asc(documents.series), asc(documents.sequential));
}
