import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './checks';
import { users } from './identity';
import { products } from './master-data';
import { warehouses } from './tenancy';

// FR-INV-1. The single source for the CHECK and for core. Transfers come after the MVP.
export const STOCK_MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'SALE',
  'RETURN_IN',
  'RESERVATION',
  'RELEASE',
] as const;

// What a movement came from, so a level's history can be followed back.
export const STOCK_SOURCE_TYPES = [
  'ADJUSTMENT',
  'OPENING_IMPORT',
  'PURCHASE_RECEIPT',
  'DOCUMENT',
] as const;

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const quantity = (name: string) => numeric(name, { precision: 18, scale: 6 });

// FR-INV-2: one row per product and warehouse, changed only with its movement, under a row
// lock. Value is the stock's total cost; the average is value over on hand while there is
// stock, and the last average once there isn't (ADR-018).
export const stockLevels = pgTable(
  'stock_levels',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    onHand: quantity('on_hand').default('0').notNull(),
    reserved: quantity('reserved').default('0').notNull(),
    value: quantity('value').default('0').notNull(),
    averageCost: quantity('average_cost').default('0').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'stock_levels_product_fk',
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    foreignKey({
      name: 'stock_levels_warehouse_fk',
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
    }),
    unique('stock_levels_product_warehouse_unique').on(
      table.tenantId,
      table.productId,
      table.warehouseId,
    ),
    check('stock_levels_reserved_check', sql`reserved >= 0`),
    check('stock_levels_average_check', sql`average_cost >= 0`),
  ],
);

// FR-INV-1: append-only. Quantity and reserved are the signed changes to the level, value
// the signed change to its total cost, so the ledger always sums to the level.
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    type: text('type', { enum: STOCK_MOVEMENT_TYPES }).notNull(),
    quantity: quantity('quantity').notNull(),
    reserved: quantity('reserved').default('0').notNull(),
    unitCost: quantity('unit_cost').notNull(),
    value: quantity('value').notNull(),
    sourceType: text('source_type', { enum: STOCK_SOURCE_TYPES }),
    sourceId: uuid('source_id'),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'stock_movements_level_fk',
      columns: [table.tenantId, table.productId, table.warehouseId],
      foreignColumns: [stockLevels.tenantId, stockLevels.productId, stockLevels.warehouseId],
    }),
    index('stock_movements_level').on(
      table.tenantId,
      table.productId,
      table.warehouseId,
      table.createdAt,
    ),
    index('stock_movements_source').on(table.tenantId, table.sourceType, table.sourceId),
    check('stock_movements_type_check', oneOf('type', STOCK_MOVEMENT_TYPES)),
    check('stock_movements_source_check', oneOf('source_type', STOCK_SOURCE_TYPES)),
    check('stock_movements_cost_check', sql`unit_cost >= 0`),
    check('stock_movements_source_pair_check', sql`(source_type IS NULL) = (source_id IS NULL)`),
  ],
);
