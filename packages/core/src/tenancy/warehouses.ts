import { eq, schema, type NEGATIVE_STOCK_RULES, type Tx } from '@comprobify/db';

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
