import type { Database } from '@comprobify/db';
import { recordDataExport } from '../audit';
import { z } from 'zod';
import { authorizedXmls, documentNumber, ridesOfAuthorized } from '../documents';
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

// Drawing each RIDE takes time and memory, so a month with more than this many documents is
// exported without them.
export const ACCOUNTANT_PDF_MAX = 1_000;

export async function accountantExport(
  ctx: ActorContext,
  db: Database,
  rawMonth: string,
  options: { pdf?: boolean } = {},
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
  const pdf = options.pdf === true;
  const limit = pdf ? Math.min(ACCOUNTANT_PDF_MAX, ZIP_MAX_ENTRIES / 2) : ZIP_MAX_ENTRIES;
  if (xmls.length > limit)
    throw new DomainError('EXPORT_TOO_LARGE', 'Too many documents for one file', { limit });
  const rides = pdf ? await ridesOfAuthorized(ctx, db, xmls) : [];
  const entry = (row: (typeof xmls)[number]) =>
    `${row.status === 'VOIDED' ? 'anulados' : 'autorizados'}/${row.documentType}-${documentNumber(row.series, row.sequential)}`;
  const zip = createZip(
    xmls.flatMap((row, index) => [
      { name: `${entry(row)}.xml`, data: row.xml },
      ...(pdf ? [{ name: `${entry(row)}.pdf`, data: rides[index]! }] : []),
    ]),
    ctx.clock.now(),
  );
  await recordDataExport(ctx, db, 'accountant_zip');
  return {
    filename: `comprobantes-${month}.zip`,
    zip,
    authorized: xmls.filter((row) => row.status === 'AUTHORIZED').length,
    voided: xmls.filter((row) => row.status === 'VOIDED').length,
  };
}
