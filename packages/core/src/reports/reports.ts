import type { Database } from '@comprobify/db';
import { z } from 'zod';
import { documentNumber, documentsIssued, salesBy, salesByProduct, taxSummary } from '../documents';
import {
  addDays,
  Dec,
  DomainError,
  ecuadorDate,
  requireFeature,
  requirePermission,
  type ActorContext,
} from '../kernel';
import { agingReport } from '../receivables';

// FR-REP-2: the reports a person reads on screen and downloads as CSV. One shape for all, so one
// page and one download serve every report: columns with a kind, rows of plain strings.
export const REPORTS = ['sales', 'documents', 'taxes', 'aging'] as const;
export type ReportKey = (typeof REPORTS)[number];

export const SALES_GROUPS = ['day', 'client', 'product'] as const;
export type SalesGroup = (typeof SALES_GROUPS)[number];

// How a cell is read: a date, an amount of money, a quantity, a count, a percentage, or text.
// `code` columns hold a status or type the screen writes out in the person's language.
export type ColumnKind = 'text' | 'code' | 'date' | 'amount' | 'quantity' | 'integer' | 'percent';
export type ReportColumn = { key: string; kind: ColumnKind };

export type ReportResult = {
  report: ReportKey;
  from: string;
  to: string;
  groupBy: SalesGroup | null;
  columns: ReportColumn[];
  rows: string[][];
  // One total per column, empty where a sum means nothing; null when the report has none.
  totals: string[] | null;
  // The rows shown were cut at the limit; the download has them all.
  truncated: boolean;
};

export const MAX_RANGE_DAYS = 366;

export const reportInput = z.object({
  report: z.enum(REPORTS),
  // Ecuador dates; the month so far when left out. Aging is as of today and takes no dates.
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  groupBy: z.enum(SALES_GROUPS).optional(),
});
export type ReportInput = z.input<typeof reportInput>;

const col = (key: string, kind: ColumnKind): ReportColumn => ({ key, kind });
const SUMMED: ColumnKind[] = ['amount', 'integer'];

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// Reading needs `reports.read`, taking the file `reports.export`; both need the reports feature.
export async function runReport(
  ctx: ActorContext,
  db: Database,
  raw: ReportInput,
  options: { export?: boolean; limit?: number } = {},
): Promise<ReportResult> {
  requirePermission(ctx, options.export ? 'reports.export' : 'reports.read');
  requireFeature(ctx, 'REPORTS_BASIC');
  const input = reportInput.parse(raw);
  const today = ecuadorDate(ctx.clock.now());
  const to = input.to ?? today;
  const from = input.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) throw new DomainError('REPORT_RANGE_INVALID', 'The range ends before it starts');
  if (daysBetween(from, to) >= MAX_RANGE_DAYS)
    throw new DomainError('REPORT_RANGE_TOO_LONG', 'Ask for a year at most', {
      days: MAX_RANGE_DAYS,
    });
  const groupBy = input.report === 'sales' ? (input.groupBy ?? 'day') : null;

  let columns: ReportColumn[];
  let rows: string[][];
  if (input.report === 'aging') {
    const report = await agingReport(ctx, db);
    columns = [
      col('number', 'text'),
      col('issueDate', 'date'),
      col('dueDate', 'date'),
      col('identification', 'text'),
      col('buyer', 'text'),
      col('daysOverdue', 'integer'),
      col('bucket', 'code'),
      col('total', 'amount'),
      col('paid', 'amount'),
      col('balance', 'amount'),
    ];
    rows = report.rows.map((row) => [
      row.number,
      row.issueDate,
      row.dueDate,
      row.buyerIdentification,
      row.buyerName,
      String(row.daysOverdue),
      row.bucket,
      row.total,
      row.paid,
      row.balance,
    ]);
  } else {
    requirePermission(ctx, 'documents.read');
    ({ columns, rows } = await db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
      if (input.report === 'documents')
        return {
          columns: [
            col('date', 'date'),
            col('type', 'code'),
            col('number', 'text'),
            col('identification', 'text'),
            col('buyer', 'text'),
            col('status', 'code'),
            col('base', 'amount'),
            col('total', 'amount'),
          ],
          rows: (await documentsIssued(tx, ctx.tenantId, from, to)).map((row) => [
            row.issueDate,
            row.documentType,
            documentNumber(row.series, row.sequential),
            row.buyerIdentification,
            row.buyerName,
            row.status,
            row.subtotal,
            row.total,
          ]),
        };
      if (input.report === 'taxes')
        return {
          columns: [
            col('rate', 'percent'),
            col('base', 'amount'),
            col('iva', 'amount'),
            col('total', 'amount'),
          ],
          rows: (await taxSummary(tx, ctx.tenantId, from, to)).map((row) => [
            row.percent,
            row.base,
            row.iva,
            new Dec(row.base).plus(row.iva).toFixed(2),
          ]),
        };
      if (groupBy === 'product')
        return {
          columns: [
            col('code', 'text'),
            col('product', 'text'),
            col('quantity', 'quantity'),
            col('base', 'amount'),
            col('iva', 'amount'),
            col('total', 'amount'),
          ],
          rows: (await salesByProduct(tx, ctx.tenantId, from, to)).map((row) => [
            row.code,
            row.name,
            row.quantity,
            row.base,
            row.iva,
            new Dec(row.base).plus(row.iva).toFixed(2),
          ]),
        };
      const by = groupBy === 'client' ? 'client' : 'day';
      const sales = await salesBy(tx, ctx.tenantId, from, to, by);
      const money = (row: (typeof sales)[number]) => [
        String(row.invoices),
        row.base,
        new Dec(row.total).minus(row.base).toFixed(2),
        row.total,
      ];
      return by === 'day'
        ? {
            columns: [
              col('date', 'date'),
              col('invoices', 'integer'),
              col('base', 'amount'),
              col('iva', 'amount'),
              col('total', 'amount'),
            ],
            rows: sales.map((row) => [row.key, ...money(row)]),
          }
        : {
            columns: [
              col('identification', 'text'),
              col('client', 'text'),
              col('invoices', 'integer'),
              col('base', 'amount'),
              col('iva', 'amount'),
              col('total', 'amount'),
            ],
            rows: sales.map((row) => [row.key, row.label, ...money(row)]),
          };
    }));
  }

  // Sums only for what is money or a count, and only where the rows are parts of one whole.
  const summed = input.report === 'sales' || input.report === 'taxes' || input.report === 'aging';
  const totals = summed
    ? columns.map((column, index) =>
        SUMMED.includes(column.kind) && !(input.report === 'aging' && column.key === 'daysOverdue')
          ? rows
              .reduce((sum, row) => sum.plus(row[index] ?? 0), new Dec(0))
              .toFixed(column.kind === 'integer' ? 0 : 2)
          : '',
      )
    : null;
  const limit = options.limit;
  return {
    report: input.report,
    from,
    to,
    groupBy,
    columns,
    rows: limit === undefined ? rows : rows.slice(0, limit),
    totals,
    truncated: limit !== undefined && rows.length > limit,
  };
}

// The first day of the month before `date`'s, for the range a page offers when asked.
export const previousMonthStart = (date: string) => {
  const first = `${date.slice(0, 7)}-01`;
  return `${addDays(first, -1).slice(0, 7)}-01`;
};
