import { and, asc, eq, schema, sql, type Tx } from '@comprobify/db';

// FR-REP-1: products with no stock left to sell. There is no minimum per product yet, so "low"
// means what is available (on hand less what is held for sale orders) is zero or below, summed
// over the warehouses.
export type LowStock = { code: string; name: string; available: string };

export async function lowStock(tx: Tx['db'], tenantId: string, limit = 5): Promise<LowStock[]> {
  const { stockLevels: levels, products } = schema;
  const available = sql<string>`sum(${levels.onHand} - ${levels.reserved})`;
  return tx
    .select({
      code: products.code,
      name: products.name,
      available: sql<string>`${available}::text`,
    })
    .from(levels)
    .innerJoin(
      products,
      and(eq(products.tenantId, levels.tenantId), eq(products.id, levels.productId)),
    )
    .where(
      and(eq(levels.tenantId, tenantId), eq(products.tracksStock, true), eq(products.active, true)),
    )
    .groupBy(products.id, products.code, products.name)
    .having(sql`${available} <= 0`)
    .orderBy(asc(available), asc(products.name))
    .limit(limit);
}
