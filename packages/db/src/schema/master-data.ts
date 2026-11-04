import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './checks';
import { SRI_ID_TYPES, SRI_IVA_RATE_CODES, SRI_TERM_UNITS } from './sri';
import { tenants } from './tenancy';

// Consumidor final is built in, never a row (FR-MD-2).
export const CLIENT_ID_TYPES = SRI_ID_TYPES.filter((type) => type !== '07');
export const PRODUCT_KINDS = ['GOOD', 'SERVICE'] as const;

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

// FR-MD-2. Lengths are the factura XSD's. The twin keeps its own (FR-ONB-5 copies later).
export const clients = pgTable(
  'clients',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    idType: text('id_type', { enum: CLIENT_ID_TYPES as [string, ...string[]] }).notNull(),
    identification: text('identification').notNull(),
    name: text('name').notNull(),
    emails: text('emails')
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    phone: text('phone'),
    address: text('address'),
    paymentTerm: integer('payment_term'),
    paymentTermUnit: text('payment_term_unit', { enum: SRI_TERM_UNITS }),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('clients_tenant_identification_unique').on(
      table.tenantId,
      table.idType,
      table.identification,
    ),
    unique('clients_tenant_id_unique').on(table.tenantId, table.id),
    check('clients_id_type_check', oneOf('id_type', CLIENT_ID_TYPES)),
    check('clients_term_unit_check', oneOf('payment_term_unit', SRI_TERM_UNITS)),
    check(
      'clients_payment_term_check',
      sql`(payment_term IS NULL) = (payment_term_unit IS NULL) AND (payment_term IS NULL OR payment_term > 0)`,
    ),
  ],
);

export type AdditionalDetail = { name: string; value: string };

// FR-MD-1. Price and cost are numeric with SRI's six decimals for unit prices (ADR-012).
export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    auxiliaryCode: text('auxiliary_code'),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind', { enum: PRODUCT_KINDS }).notNull(),
    unit: text('unit'),
    price: numeric('price', { precision: 18, scale: 6 }).notNull(),
    cost: numeric('cost', { precision: 18, scale: 6 }),
    ivaRateCode: text('iva_rate_code').notNull(),
    // Used once inventory exists (Milestone 5).
    tracksStock: boolean('tracks_stock').default(false).notNull(),
    // SRI's detAdicional: at most three, each up to 300 characters (FR-DOC-9).
    additionalDetails: jsonb('additional_details')
      .$type<AdditionalDetail[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('products_tenant_code_unique').on(table.tenantId, table.code),
    unique('products_tenant_id_unique').on(table.tenantId, table.id),
    check('products_kind_check', oneOf('kind', PRODUCT_KINDS)),
    check('products_iva_rate_check', oneOf('iva_rate_code', SRI_IVA_RATE_CODES)),
    check('products_price_check', sql`price >= 0 AND (cost IS NULL OR cost >= 0)`),
    check(
      'products_details_check',
      sql`jsonb_typeof(additional_details) = 'array' AND jsonb_array_length(additional_details) <= 3`,
    ),
  ],
);
