import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf, transitionTriggerBody } from './checks';
import { users } from './identity';
import { products, providers } from './master-data';
import { SRI_IVA_RATE_CODES } from './sri';
import { warehouses } from './tenancy';

// FR-PUR-1, FR-DOC-3. The one definition of the order's status machine: the CHECK, the
// trigger (purchaseOrderStatusTriggerBody) and core's checks all come from it (ADR-019).
export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_TRANSITIONS: Record<
  PurchaseOrderStatus,
  readonly PurchaseOrderStatus[]
> = {
  DRAFT: ['SENT', 'CANCELLED'],
  // Receiving moves it on (FR-PUR-2): all at once, or in parts.
  SENT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  // Closing short: the rest won't come, so nothing more is received.
  PARTIALLY_RECEIVED: ['RECEIVED', 'CLOSED'],
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const amount = (name: string) => numeric(name, { precision: 14, scale: 2 });
const precise = (name: string) => numeric(name, { precision: 18, scale: 6 });

// Goods arrive at one warehouse. Amounts are without discounts: a provider's price is the
// cost. Lines belong to a revision; editing a draft adds one instead of deleting rows.
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    number: integer('number').notNull(),
    providerId: uuid('provider_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    status: text('status', { enum: PURCHASE_ORDER_STATUSES }).default('DRAFT').notNull(),
    revision: integer('revision').default(1).notNull(),
    orderDate: date('order_date').notNull(),
    expectedDate: date('expected_date'),
    notes: text('notes'),
    subtotal: amount('subtotal').notNull(),
    iva: amount('iva').notNull(),
    total: amount('total').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'purchase_orders_provider_fk',
      columns: [table.tenantId, table.providerId],
      foreignColumns: [providers.tenantId, providers.id],
    }),
    foreignKey({
      name: 'purchase_orders_warehouse_fk',
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
    }),
    unique('purchase_orders_tenant_number_unique').on(table.tenantId, table.number),
    unique('purchase_orders_tenant_id_unique').on(table.tenantId, table.id),
    index('purchase_orders_provider').on(table.tenantId, table.providerId),
    check('purchase_orders_status_check', oneOf('status', PURCHASE_ORDER_STATUSES)),
    check('purchase_orders_number_check', sql`number > 0 AND revision > 0`),
    check(
      'purchase_orders_amounts_check',
      sql`subtotal >= 0 AND iva >= 0 AND total = subtotal + iva`,
    ),
    check(
      'purchase_orders_expected_check',
      sql`expected_date IS NULL OR expected_date >= order_date`,
    ),
    check('purchase_orders_cancel_check', sql`(status = 'CANCELLED') = (cancelled_at IS NOT NULL)`),
  ],
);

// What was ordered, from the catalogue, and how much of it has arrived (FR-PUR-2).
export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    revision: integer('revision').notNull(),
    position: integer('position').notNull(),
    productId: uuid('product_id').notNull(),
    // As the product was when ordered, so the order reads the same later.
    code: text('code').notNull(),
    name: text('name').notNull(),
    unit: text('unit'),
    quantity: precise('quantity').notNull(),
    receivedQuantity: precise('received_quantity').default('0').notNull(),
    unitCost: precise('unit_cost').notNull(),
    ivaRateCode: text('iva_rate_code').notNull(),
    subtotal: amount('subtotal').notNull(),
    iva: amount('iva').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'purchase_order_lines_order_fk',
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }),
    foreignKey({
      name: 'purchase_order_lines_product_fk',
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    unique('purchase_order_lines_position_unique').on(
      table.orderId,
      table.revision,
      table.position,
    ),
    unique('purchase_order_lines_tenant_id_unique').on(table.tenantId, table.id),
    check('purchase_order_lines_iva_check', oneOf('iva_rate_code', SRI_IVA_RATE_CODES)),
    check(
      'purchase_order_lines_quantity_check',
      sql`quantity > 0 AND received_quantity >= 0 AND received_quantity <= quantity`,
    ),
    check('purchase_order_lines_amounts_check', sql`unit_cost >= 0 AND subtotal >= 0 AND iva >= 0`),
  ],
);

// The trigger that enforces PURCHASE_ORDER_TRANSITIONS; migration 0040 holds its output.
export const purchaseOrderStatusTriggerBody = (): string =>
  transitionTriggerBody('Purchase order', PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_TRANSITIONS);
