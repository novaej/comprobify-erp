import type { Database } from '@comprobify/db';
import { z } from 'zod';
import { authorizedXmls, documentNumber } from '../documents';
import {
  createZip,
  DomainError,
  requireFeature,
  requirePermission,
  ZIP_MAX_ENTRIES,
  type ActorContext,
} from '../kernel';

// FR-REP-3: what an accountant needs for a month, in one file: the SRI's authorization of every
// document issued in it, as a ZIP. Authorized ones go in `autorizados/`, and the ones voided
// afterwards in `anulados/`, since they were declared before they were voided.
export const accountantMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export type AccountantExport = {
  filename: string;
  zip: Buffer;
  authorized: number;
  voided: number;
};

export async function accountantExport(
  ctx: ActorContext,
  db: Database,
  rawMonth: string,
): Promise<AccountantExport> {
  requirePermission(ctx, 'reports.export');
  requirePermission(ctx, 'documents.read');
  requireFeature(ctx, 'REPORTS_BASIC');
  const month = accountantMonth.parse(rawMonth);
  const [year, number] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const xmls = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    authorizedXmls(tx, ctx.tenantId, `${month}-01`, `${month}-${String(last).padStart(2, '0')}`),
  );
  if (xmls.length === 0)
    throw new DomainError('EXPORT_EMPTY', 'There are no authorized documents in that month');
  if (xmls.length > ZIP_MAX_ENTRIES)
    throw new DomainError('EXPORT_TOO_LARGE', 'Too many documents for one file', {
      limit: ZIP_MAX_ENTRIES,
    });
  const zip = createZip(
    xmls.map((row) => ({
      name: `${row.status === 'VOIDED' ? 'anulados' : 'autorizados'}/${row.documentType}-${documentNumber(row.series, row.sequential)}.xml`,
      data: row.xml,
    })),
    ctx.clock.now(),
  );
  return {
    filename: `comprobantes-${month}.zip`,
    zip,
    authorized: xmls.filter((row) => row.status === 'AUTHORIZED').length,
    voided: xmls.filter((row) => row.status === 'VOIDED').length,
  };
}
