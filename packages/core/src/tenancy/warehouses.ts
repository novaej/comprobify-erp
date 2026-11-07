import { and, asc, eq, schema, type NEGATIVE_STOCK_RULES, type Tx } from '@comprobify/db';

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
      active: warehouses.active,
    })
    .from(warehouses)
    .innerJoin(
      branches,
      and(eq(branches.tenantId, warehouses.tenantId), eq(branches.id, warehouses.branchId)),
    )
    .orderBy(asc(branches.code));
}
