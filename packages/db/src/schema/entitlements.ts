import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './checks';

export const FEATURE_KINDS = ['BOOLEAN', 'LIMIT'] as const;
export const MODULE_STATUSES = ['AVAILABLE', 'COMING_SOON'] as const;
export const PLAN_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;

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
