import {
  and,
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
