import { and, desc, eq, gte, inArray, lte, schema, sql, type Tx } from '@comprobify/db';

// FR-REP-2: what was ordered from each provider over a range of order dates. A draft is not an
// order yet and a cancelled one never happened, so neither counts.
export type ProviderPurchases = {
  identification: string;
  name: string;
  orders: number;
  subtotal: string;
  iva: string;
  total: string;
};

export async function purchasesByProvider(
  tx: Tx['db'],
  tenantId: string,
  from: string,
  to: string,
): Promise<ProviderPurchases[]> {
  const { purchaseOrders: orders, providers } = schema;
  return tx
    .select({
      identification: providers.identification,
      name: providers.name,
      orders: sql<number>`count(*)::int`,
      subtotal: sql<string>`sum(${orders.subtotal})::text`,
      iva: sql<string>`sum(${orders.iva})::text`,
      total: sql<string>`sum(${orders.total})::text`,
    })
    .from(orders)
    .innerJoin(
      providers,
      and(eq(providers.tenantId, orders.tenantId), eq(providers.id, orders.providerId)),
    )
    .where(
      and(
        eq(orders.tenantId, tenantId),
        inArray(orders.status, ['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED']),
        gte(orders.orderDate, from),
        lte(orders.orderDate, to),
      ),
    )
    .groupBy(providers.id, providers.identification, providers.name)
    .orderBy(desc(sql`sum(${orders.total})`));
}
