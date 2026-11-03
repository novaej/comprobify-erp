import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './checks';
import { users } from './identity';
import { tenants } from './tenancy';

export const FEATURE_KINDS = ['BOOLEAN', 'LIMIT'] as const;
export const MODULE_STATUSES = ['AVAILABLE', 'COMING_SOON'] as const;
export const PLAN_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export const SUBSCRIPTION_BILLING = ['PAID', 'COMPLIMENTARY'] as const;
// Milestone 8 adds extra seats and document packs.
export const SUBSCRIPTION_ITEM_KINDS = ['MODULE', 'LIMIT'] as const;
export const OVERRIDE_EFFECTS = ['GRANT', 'REVOKE', 'LIMIT'] as const;

// ADR-011. Platform data, no tenant_id. Keys come from the code registry,
// synced by the migrate step; (key, kind) lets the link tables demand a kind.
export const features = pgTable(
  'features',
  {
    key: text('key').primaryKey(),
    kind: text('kind', { enum: FEATURE_KINDS }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('features_key_kind_unique').on(table.key, table.kind),
    check('features_kind_check', oneOf('kind', FEATURE_KINDS)),
  ],
);

// The unit that is sold. Exactly one is the base, which every plan contains.
export const modules = pgTable(
  'modules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    key: text('key').notNull().unique(),
    nameEs: text('name_es').notNull(),
    nameEn: text('name_en').notNull(),
    status: text('status', { enum: MODULE_STATUSES }).notNull(),
    isBase: boolean('is_base').default(false).notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('modules_status_check', oneOf('status', MODULE_STATUSES)),
    uniqueIndex('modules_one_base')
      .on(table.isBase)
      .where(sql`is_base`),
  ],
);

// removes_at: a removal is dated ahead, never a deleted row (ADR-011, rule 12).
export const moduleFeatures = pgTable(
  'module_features',
  {
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id),
    featureKey: text('feature_key').notNull(),
    featureKind: text('feature_kind', { enum: FEATURE_KINDS }).default('BOOLEAN').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    removesAt: timestamp('removes_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.moduleId, table.featureKey] }),
    check('module_features_boolean_check', sql`feature_kind = 'BOOLEAN'`),
    foreignKey({
      name: 'module_features_feature_fk',
      columns: [table.featureKey, table.featureKind],
      foreignColumns: [features.key, features.kind],
    }),
  ],
);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    key: text('key').notNull().unique(),
    nameEs: text('name_es').notNull(),
    nameEn: text('name_en').notNull(),
    status: text('status', { enum: PLAN_STATUSES }).notNull(),
    // Personalizado is set up by the operator, never bought from the app.
    selfService: boolean('self_service').notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  () => [check('plans_status_check', oneOf('status', PLAN_STATUSES))],
);

export const planModules = pgTable(
  'plan_modules',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    removesAt: timestamp('removes_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.planId, table.moduleId] })],
);

// value null = unlimited (FR-PLAN-1).
export const planLimits = pgTable(
  'plan_limits',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    featureKey: text('feature_key').notNull(),
    featureKind: text('feature_kind', { enum: FEATURE_KINDS }).default('LIMIT').notNull(),
    value: integer('value'),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.featureKey] }),
    check('plan_limits_limit_check', sql`feature_kind = 'LIMIT'`),
    check('plan_limits_value_check', sql`value IS NULL OR value >= 0`),
    foreignKey({
      name: 'plan_limits_feature_fk',
      columns: [table.featureKey, table.featureKind],
      foreignColumns: [features.key, features.kind],
    }),
  ],
);

// Tenant data from here on: forced RLS, and mirrored into the twin in the same
// transaction, so the twin's own RLS reads them (ADR-011, FR-ONB-6a).

// One per tenant. PAID is billed by the plan's price (Gratis costs nothing);
// COMPLIMENTARY is never charged and needs the operator's reason (FR-PLAN-1b).
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    billing: text('billing', { enum: SUBSCRIPTION_BILLING }).default('PAID').notNull(),
    complimentaryReason: text('complimentary_reason'),
    // Personalizado's negotiated price before IVA; yearly is 10x (FR-BILL-1).
    negotiatedMonthlyPrice: numeric('negotiated_monthly_price', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('subscriptions_tenant_unique').on(table.tenantId),
    unique('subscriptions_tenant_id_unique').on(table.tenantId, table.id),
    check('subscriptions_billing_check', oneOf('billing', SUBSCRIPTION_BILLING)),
    check(
      'subscriptions_complimentary_reason_check',
      sql`(billing = 'COMPLIMENTARY') = (complimentary_reason IS NOT NULL)`,
    ),
    check(
      'subscriptions_negotiated_price_check',
      sql`negotiated_monthly_price IS NULL OR negotiated_monthly_price >= 0`,
    ),
  ],
);

// A module on top of the plan, or one of Personalizado's limits (null = unlimited).
export const subscriptionItems = pgTable(
  'subscription_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    subscriptionId: uuid('subscription_id').notNull(),
    kind: text('kind', { enum: SUBSCRIPTION_ITEM_KINDS }).notNull(),
    moduleId: uuid('module_id').references(() => modules.id),
    featureKey: text('feature_key'),
    featureKind: text('feature_kind', { enum: FEATURE_KINDS }).default('LIMIT').notNull(),
    limitValue: integer('limit_value'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'subscription_items_subscription_fk',
      columns: [table.tenantId, table.subscriptionId],
      foreignColumns: [subscriptions.tenantId, subscriptions.id],
    }),
    // A null feature_key (a module item) skips this reference.
    foreignKey({
      name: 'subscription_items_feature_fk',
      columns: [table.featureKey, table.featureKind],
      foreignColumns: [features.key, features.kind],
    }),
    check('subscription_items_kind_check', oneOf('kind', SUBSCRIPTION_ITEM_KINDS)),
    check('subscription_items_limit_kind_check', sql`feature_kind = 'LIMIT'`),
    check(
      'subscription_items_shape_check',
      sql`CASE kind
            WHEN 'MODULE' THEN module_id IS NOT NULL AND feature_key IS NULL AND limit_value IS NULL
            WHEN 'LIMIT' THEN module_id IS NULL AND feature_key IS NOT NULL
          END`,
    ),
    check('subscription_items_value_check', sql`limit_value IS NULL OR limit_value >= 0`),
    uniqueIndex('subscription_items_active_module')
      .on(table.subscriptionId, table.moduleId)
      .where(sql`active AND kind = 'MODULE'`),
    uniqueIndex('subscription_items_active_limit')
      .on(table.subscriptionId, table.featureKey)
      .where(sql`active AND kind = 'LIMIT'`),
  ],
);

// The operator's exception for one company, which wins over everything (FR-PLAN-1).
export const tenantFeatureOverrides = pgTable(
  'tenant_feature_overrides',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    featureKey: text('feature_key').notNull(),
    featureKind: text('feature_kind', { enum: FEATURE_KINDS }).notNull(),
    effect: text('effect', { enum: OVERRIDE_EFFECTS }).notNull(),
    limitValue: integer('limit_value'),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'tenant_feature_overrides_feature_fk',
      columns: [table.featureKey, table.featureKind],
      foreignColumns: [features.key, features.kind],
    }),
    check('tenant_feature_overrides_effect_check', oneOf('effect', OVERRIDE_EFFECTS)),
    // GRANT and REVOKE are for booleans; LIMIT sets a limit's value.
    check(
      'tenant_feature_overrides_shape_check',
      sql`CASE effect
            WHEN 'LIMIT' THEN feature_kind = 'LIMIT'
            ELSE feature_kind = 'BOOLEAN' AND limit_value IS NULL
          END`,
    ),
    check('tenant_feature_overrides_value_check', sql`limit_value IS NULL OR limit_value >= 0`),
    uniqueIndex('tenant_feature_overrides_active_key')
      .on(table.tenantId, table.featureKey)
      .where(sql`active`),
  ],
);
