import { and, asc, eq, gte, lte, schema, sql, type Tx } from '@comprobify/db';
import { endOfEcuadorDay, startOfEcuadorDay } from '../kernel';

// FR-REP-2: every stock movement made in a range of Ecuador dates, oldest first.
export type ReportMovement = {
  date: string;
  type: string;
  code: string;
  product: string;
  warehouse: string;
  quantity: string;
  unitCost: string;
  value: string;
  reason: string | null;
};

export async function reportMovements(
  tx: Tx['db'],
  tenantId: string,
  from: string,
  to: string,
): Promise<ReportMovement[]> {
  const { stockMovements: movements, products, warehouses } = schema;
  return tx
    .select({
      date: sql<string>`to_char(${movements.createdAt} AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD')`,
      type: movements.type,
      code: products.code,
      product: products.name,
      warehouse: warehouses.name,
      quantity: sql<string>`${movements.quantity}::text`,
      unitCost: sql<string>`${movements.unitCost}::text`,
      value: sql<string>`${movements.value}::text`,
      reason: movements.reason,
    })
    .from(movements)
    .innerJoin(
      products,
      and(eq(products.tenantId, movements.tenantId), eq(products.id, movements.productId)),
    )
    .innerJoin(
      warehouses,
      and(eq(warehouses.tenantId, movements.tenantId), eq(warehouses.id, movements.warehouseId)),
    )
    .where(
      and(
        eq(movements.tenantId, tenantId),
        gte(movements.createdAt, startOfEcuadorDay(from)),
        lte(movements.createdAt, endOfEcuadorDay(to)),
      ),
    )
    .orderBy(asc(movements.createdAt), asc(movements.id));
}
