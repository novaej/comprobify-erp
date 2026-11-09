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
import { clients, products } from './master-data';
import { SRI_IVA_RATE_CODES } from './sri';
import { warehouses } from './tenancy';

// FR-SAL-1, FR-DOC-3. The one definition of the order's status machine: the CHECK, the trigger
// (saleOrderStatusTriggerBody) and core's checks all come from it (ADR-021).
export const SALE_ORDER_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_INVOICED',
  'INVOICED',
  'CANCELLED',
] as const;
export type SaleOrderStatus = (typeof SALE_ORDER_STATUSES)[number];

export const SALE_ORDER_TRANSITIONS: Record<SaleOrderStatus, readonly SaleOrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  // Invoicing moves it on (FR-SAL-3); a voided invoice gives its quantities back (FR-SAL-4),
  // which moves it back.
  CONFIRMED: ['PARTIALLY_INVOICED', 'INVOICED', 'CANCELLED'],
  PARTIALLY_INVOICED: ['CONFIRMED', 'INVOICED'],
  INVOICED: ['PARTIALLY_INVOICED', 'CONFIRMED'],
  CANCELLED: [],
};

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const amount = (name: string) => numeric(name, { precision: 14, scale: 2 });
const precise = (name: string) => numeric(name, { precision: 18, scale: 6 });

// What a client asks for, from one warehouse. A null client is consumidor final. Lines belong
// to a revision; editing adds one instead of deleting rows (rule 12).
export const saleOrders = pgTable(
  'sale_orders',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    number: integer('number').notNull(),
    clientId: uuid('client_id'),
    warehouseId: uuid('warehouse_id').notNull(),
    status: text('status', { enum: SALE_ORDER_STATUSES }).default('DRAFT').notNull(),
    revision: integer('revision').default(1).notNull(),
    orderDate: date('order_date').notNull(),
    notes: text('notes'),
    // As priced when the revision was saved: subtotal after discounts, then IVA.
    subtotal: amount('subtotal').notNull(),
    iva: amount('iva').notNull(),
    total: amount('total').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'sale_orders_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
    foreignKey({
      name: 'sale_orders_warehouse_fk',
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
    }),
    unique('sale_orders_tenant_number_unique').on(table.tenantId, table.number),
    unique('sale_orders_tenant_id_unique').on(table.tenantId, table.id),
    index('sale_orders_client').on(table.tenantId, table.clientId),
    check('sale_orders_status_check', oneOf('status', SALE_ORDER_STATUSES)),
    check('sale_orders_number_check', sql`number > 0 AND revision > 0`),
    check('sale_orders_amounts_check', sql`subtotal >= 0 AND iva >= 0 AND total = subtotal + iva`),
    check('sale_orders_cancel_check', sql`(status = 'CANCELLED') = (cancelled_at IS NOT NULL)`),
  ],
);

// What was ordered, from the catalogue, as the product and its price were then.
export const saleOrderLines = pgTable(
  'sale_order_lines',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    revision: integer('revision').notNull(),
    position: integer('position').notNull(),
    productId: uuid('product_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    unit: text('unit'),
    quantity: precise('quantity').notNull(),
    unitPrice: precise('unit_price').notNull(),
    discount: amount('discount').notNull(),
    ivaRateCode: text('iva_rate_code').notNull(),
    ivaPercent: numeric('iva_percent', { precision: 5, scale: 2 }).notNull(),
    base: amount('base').notNull(),
    iva: amount('iva').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'sale_order_lines_order_fk',
      columns: [table.tenantId, table.orderId],
      foreignColumns: [saleOrders.tenantId, saleOrders.id],
    }),
    foreignKey({
      name: 'sale_order_lines_product_fk',
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    unique('sale_order_lines_position_unique').on(table.orderId, table.revision, table.position),
    unique('sale_order_lines_tenant_id_unique').on(table.tenantId, table.id),
    check('sale_order_lines_iva_check', oneOf('iva_rate_code', SRI_IVA_RATE_CODES)),
    check('sale_order_lines_quantity_check', sql`quantity > 0`),
    check(
      'sale_order_lines_amounts_check',
      sql`unit_price >= 0 AND discount >= 0 AND base >= 0 AND iva >= 0`,
    ),
  ],
);

// The trigger that enforces SALE_ORDER_TRANSITIONS; migration 0044 holds its output.
export const saleOrderStatusTriggerBody = (): string =>
  transitionTriggerBody('Sale order', SALE_ORDER_STATUSES, SALE_ORDER_TRANSITIONS);
