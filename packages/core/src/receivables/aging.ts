import { type Database } from '@comprobify/db';
import { z } from 'zod';
import { receivableInvoices } from '../documents';
import { Dec, daysBetween, ecuadorDate, toSriAmount, type ActorContext } from '../kernel';
import { balanceOf, canRead, paidBy } from './payments';

// FR-SAL-10 (ADR-024): what clients owe, by how late it is.

export const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

// Days past the due date: 0 or less is not yet due.
export function bucketOf(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return 'D1_30';
  if (daysOverdue <= 60) return 'D31_60';
  if (daysOverdue <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export const agingFilters = z.object({
  bucket: z.enum(AGING_BUCKETS).optional(),
  // A client's identification, as the invoice states it.
  buyer: z.string().trim().max(20).optional(),
});
export type AgingFilters = z.input<typeof agingFilters>;

export type AgingRow = {
  id: string;
  number: string;
  buyerName: string;
  buyerIdentification: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: AgingBucket;
  total: string;
  paid: string;
  balance: string;
};

export type AgingReport = {
  asOf: string;
  // What is owed in each bucket, whatever the filter, so the filter's choices keep their sums.
  buckets: { bucket: AgingBucket; count: number; balance: string }[];
  total: string;
  // Oldest due first; the filter applies here.
  rows: AgingRow[];
};

// Every authorized invoice with something left to collect, as of today in Ecuador.
export async function agingReport(
  ctx: ActorContext,
  db: Database,
  raw: AgingFilters = {},
): Promise<AgingReport> {
  canRead(ctx);
  const filters = agingFilters.parse(raw);
  const asOf = ecuadorDate(ctx.clock.now());
  return db.withTenant({ tenantId: ctx.tenantId }, async (tx) => {
    // One after another: a transaction is one connection, which runs one query at a time.
    const invoices = await receivableInvoices(ctx, tx);
    const paid = await paidBy(tx);
    const open: AgingRow[] = [];
    for (const invoice of invoices) {
      const paidSoFar = paid.get(invoice.id) ?? new Dec(0);
      const balance = balanceOf(invoice, paidSoFar);
      if (!balance.gt(0)) continue;
      const daysOverdue = daysBetween(invoice.dueDate, asOf);
      open.push({
        id: invoice.id,
        number: invoice.number,
        buyerName: invoice.buyerName,
        buyerIdentification: invoice.buyerIdentification,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        daysOverdue: Math.max(daysOverdue, 0),
        bucket: bucketOf(daysOverdue),
        total: invoice.total,
        paid: toSriAmount(paidSoFar),
        balance: toSriAmount(balance),
      });
    }
    open.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
    const buckets = AGING_BUCKETS.map((bucket) => {
      const inBucket = open.filter((row) => row.bucket === bucket);
      return {
        bucket,
        count: inBucket.length,
        balance: toSriAmount(inBucket.reduce((sum, row) => sum.add(row.balance), new Dec(0))),
      };
    });
    return {
      asOf,
      buckets,
      total: toSriAmount(open.reduce((sum, row) => sum.add(row.balance), new Dec(0))),
      rows: open.filter(
        (row) =>
          (!filters.bucket || row.bucket === filters.bucket) &&
          (!filters.buyer || row.buyerIdentification === filters.buyer),
      ),
    };
  });
}
