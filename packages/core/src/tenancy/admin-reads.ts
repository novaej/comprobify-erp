import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  or,
  schema,
  type SuspensionReason,
  type Tx,
} from '@comprobify/db';
import { DomainError } from '../kernel';

// Reads for the super admin area, in the caller's system-context transaction.

export type CompanyRow = {
  realTenantId: string;
  twinTenantId: string;
  ruc: string;
  name: string;
  legalName: string;
  status: 'ACTIVE' | 'SUSPENDED';
  // FR-BILL-9: why and since when, while suspended.
  suspensionReason: SuspensionReason | null;
  suspendedAt: Date | null;
  liveAt: Date | null;
  createdAt: Date;
};

const columns = () => {
  const { tenants } = schema;
  return {
    realTenantId: tenants.id,
    ruc: tenants.ruc,
    legalName: tenants.legalName,
    tradeName: tenants.tradeName,
    status: tenants.status,
    suspensionReason: tenants.suspensionReason,
    suspendedAt: tenants.suspendedAt,
    liveAt: tenants.liveAt,
    createdAt: tenants.createdAt,
  };
};

async function withTwins(
  tx: Tx['db'],
  rows: (Omit<CompanyRow, 'twinTenantId' | 'name'> & { tradeName: string | null })[],
): Promise<CompanyRow[]> {
  if (rows.length === 0) return [];
  const { tenants } = schema;
  const twins = await tx
    .select({ id: tenants.id, twinOf: tenants.twinOf })
    .from(tenants)
    .where(
      inArray(
        tenants.twinOf,
        rows.map((row) => row.realTenantId),
      ),
    );
  const twinOf = new Map(twins.map((twin) => [twin.twinOf!, twin.id]));
  return rows.map(({ tradeName, ...row }) => {
    const twinTenantId = twinOf.get(row.realTenantId);
    // Every company is created with its twin (FR-ONB-4).
    if (!twinTenantId) throw new Error(`Company ${row.realTenantId} has no twin`);
    return { ...row, twinTenantId, name: tradeName ?? row.legalName };
  });
}

// Real companies, newest first, optionally matching a RUC or name.
export async function listCompanyRows(
  tx: Tx['db'],
  options: { query?: string; limit?: number } = {},
): Promise<CompanyRow[]> {
  const { tenants } = schema;
  const query = options.query?.trim();
  const pattern = query ? `%${query.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await tx
    .select(columns())
    .from(tenants)
    .where(
      and(
        eq(tenants.mode, 'PRODUCTION'),
        pattern
          ? or(
              ilike(tenants.ruc, pattern),
              ilike(tenants.legalName, pattern),
              ilike(tenants.tradeName, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(desc(tenants.createdAt))
    .limit(options.limit ?? 100);
  return withTwins(tx, rows);
}

// One real company and its twin; a twin's id is refused, so callers can't mix them up.
export async function companyRow(tx: Tx['db'], realTenantId: string): Promise<CompanyRow> {
  const { tenants } = schema;
  const rows = await tx
    .select(columns())
    .from(tenants)
    .where(and(eq(tenants.id, realTenantId), eq(tenants.mode, 'PRODUCTION')));
  if (rows.length === 0) throw new DomainError('NOT_FOUND', 'Company not found');
  return (await withTwins(tx, rows))[0]!;
}
