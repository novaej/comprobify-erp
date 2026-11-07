import type { Logger } from '@comprobify/config/logger';
import type { Database } from '@comprobify/db';

// FR-INV-2: levels are never recomputed on the hot path, so every night they are compared
// with the ledger they came from: quantity, reserved and value must be its sums (ADR-018).
// The average isn't compared: an outflow keeps it while rounding moves value over quantity
// by a millionth, so only the sums are exact. The notification
// arrives with notifications (Milestone 9); today a drift is logged as an error.

export type StockDrift = {
  tenantId: string;
  productId: string;
  warehouseId: string;
  onHand: string;
  ledgerOnHand: string;
  reserved: string;
  ledgerReserved: string;
  value: string;
  ledgerValue: string;
};

const DRIFT_QUERY = `
  SELECT l.tenant_id AS "tenantId", l.product_id AS "productId", l.warehouse_id AS "warehouseId",
         l.on_hand::text AS "onHand", coalesce(m.quantity, 0)::text AS "ledgerOnHand",
         l.reserved::text AS "reserved", coalesce(m.reserved, 0)::text AS "ledgerReserved",
         l.value::text AS "value", coalesce(m.value, 0)::text AS "ledgerValue"
  FROM stock_levels l
  LEFT JOIN (
    SELECT tenant_id, product_id, warehouse_id,
           sum(quantity) AS quantity, sum(reserved) AS reserved, sum(value) AS value
    FROM stock_movements
    GROUP BY tenant_id, product_id, warehouse_id
  ) m USING (tenant_id, product_id, warehouse_id)
  WHERE l.on_hand <> coalesce(m.quantity, 0)
     OR l.reserved <> coalesce(m.reserved, 0)
     OR l.value <> coalesce(m.value, 0)
  ORDER BY l.tenant_id, l.product_id, l.warehouse_id`;

export async function verifyStockLevels(deps: {
  db: Database;
  logger: Logger;
}): Promise<{ checked: number; drifts: StockDrift[] }> {
  const { checked, drifts } = await deps.db.withSystem(
    'nightly check: compare every stock level with its ledger',
    async ({ executeSql }) => {
      const count = await executeSql<{ n: number }>('SELECT count(*)::int AS n FROM stock_levels');
      const found = await executeSql<StockDrift>(DRIFT_QUERY);
      return { checked: count.rows[0]!.n, drifts: found.rows };
    },
  );
  for (const drift of drifts)
    deps.logger.error('A stock level differs from its ledger', {
      event: 'inventory.drift',
      tenantId: drift.tenantId,
      // Identifiers and amounts only: nothing about the goods themselves.
      reason:
        `product ${drift.productId} warehouse ${drift.warehouseId}: on hand ${drift.onHand} vs ${drift.ledgerOnHand}, ` +
        `reserved ${drift.reserved} vs ${drift.ledgerReserved}, value ${drift.value} vs ${drift.ledgerValue}`,
    });
  deps.logger.info(`Checked ${checked} stock levels, ${drifts.length} with drift`, {
    event: 'inventory.verified',
  });
  return { checked, drifts };
}
