import {
  and,
  asc,
  eq,
  schema,
  sql,
  type COUNTER_KINDS,
  type NEGATIVE_STOCK_RULES,
  type Tx,
} from '@comprobify/db';

// FR-INV-4: whether an outflow may take a level below what is available. Read in the
// caller's transaction, so the rule applied is the one in force when the stock moves.
export async function negativeStockRule(
  tx: Tx,
  tenantId: string,
): Promise<(typeof NEGATIVE_STOCK_RULES)[number]> {
  const [row] = await tx.db
    .select({ rule: schema.tenants.negativeStock })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return row?.rule ?? 'BLOCK';
}

export type Warehouse = {
  id: string;
  name: string;
  branchCode: string;
  branchName: string;
  branchAddress: string;
  active: boolean;
};

// One per branch (FR-MD-4), in branch order, read in the caller's transaction.
export async function warehousesOf(tx: Tx): Promise<Warehouse[]> {
  const { warehouses, branches } = schema;
  return tx.db
    .select({
      id: warehouses.id,
      name: warehouses.name,
      branchCode: branches.code,
      branchName: branches.name,
      branchAddress: branches.address,
      active: warehouses.active,
    })
    .from(warehouses)
    .innerJoin(
      branches,
      and(eq(branches.tenantId, warehouses.tenantId), eq(branches.id, warehouses.branchId)),
    )
    .orderBy(asc(branches.code));
}

// The company's next number of a kind, taken in the caller's transaction: an upsert holds
// the row until commit, so two at once wait and never share one, and a rollback gives it back.
export async function nextNumber(
  tx: Tx,
  tenantId: string,
  kind: (typeof COUNTER_KINDS)[number],
): Promise<number> {
  const { tenantCounters } = schema;
  const [row] = await tx.db
    .insert(tenantCounters)
    .values({ tenantId, kind, lastValue: 1 })
    .onConflictDoUpdate({
      target: [tenantCounters.tenantId, tenantCounters.kind],
      set: { lastValue: sql`${tenantCounters.lastValue} + 1` },
    })
    .returning({ value: tenantCounters.lastValue });
  return row!.value;
}

export type CompanyHeader = {
  ruc: string;
  legalName: string;
  tradeName: string | null;
  mainAddress: string;
  mode: string;
};

// Who the company is, for the papers it sends that aren't SRI documents (FR-PUR-3).
export async function companyHeader(tx: Tx, tenantId: string): Promise<CompanyHeader> {
  const { tenants } = schema;
  const [row] = await tx.db
    .select({
      ruc: tenants.ruc,
      legalName: tenants.legalName,
      tradeName: tenants.tradeName,
      mainAddress: tenants.mainAddress,
      mode: tenants.mode,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!row) throw new Error('A tenant that owns the row is missing');
  return row;
}
