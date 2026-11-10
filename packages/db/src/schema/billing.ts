import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf, transitionTriggerBody } from './checks';
import { modules, plans } from './entitlements';
import { users } from './identity';

// FR-BILL-6 (ADR-027): what is sold and for how much, with its history. A plan, an add-on
// module and an extra seat cost a monthly amount (yearly is 10 times it, FR-BILL-1); a
// document pack costs its amount once.
export const PRICE_KINDS = ['PLAN', 'MODULE', 'SEAT', 'PACK'] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

// A draft is the super admin's work in progress; publishing dates it and it never changes
// again. A draft that isn't wanted is discarded, never deleted (rule 12).
export const PRICE_STATUSES = ['DRAFT', 'PUBLISHED', 'DISCARDED'] as const;
export type PriceStatus = (typeof PRICE_STATUSES)[number];
export const PRICE_TRANSITIONS: Record<PriceStatus, readonly PriceStatus[]> = {
  DRAFT: ['PUBLISHED', 'DISCARDED'],
  PUBLISHED: [],
  DISCARDED: [],
};

// Platform data, like the plans it prices: no tenant, written in system context only.
export const prices = pgTable(
  'prices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text('kind', { enum: PRICE_KINDS }).notNull(),
    planId: uuid('plan_id').references(() => plans.id),
    moduleId: uuid('module_id').references(() => modules.id),
    // A pack's size in documents; the size is what is sold.
    packSize: integer('pack_size'),
    // Before IVA. Null only for a pack no longer sold from `effective_on`.
    amount: numeric('amount', { precision: 12, scale: 2 }),
    status: text('status', { enum: PRICE_STATUSES }).default('DRAFT').notNull(),
    // The Ecuador date it applies from; set when published.
    effectiveOn: date('effective_on'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('prices_kind_check', oneOf('kind', PRICE_KINDS)),
    check('prices_status_check', oneOf('status', PRICE_STATUSES)),
    check(
      'prices_shape_check',
      sql`CASE kind
            WHEN 'PLAN' THEN plan_id IS NOT NULL AND module_id IS NULL AND pack_size IS NULL
            WHEN 'MODULE' THEN module_id IS NOT NULL AND plan_id IS NULL AND pack_size IS NULL
            WHEN 'SEAT' THEN plan_id IS NULL AND module_id IS NULL AND pack_size IS NULL
            WHEN 'PACK' THEN pack_size > 0 AND plan_id IS NULL AND module_id IS NULL
          END`,
    ),
    check('prices_amount_check', sql`amount IS NULL OR amount >= 0`),
    check('prices_withdrawn_check', sql`amount IS NOT NULL OR kind = 'PACK'`),
    check(
      'prices_published_check',
      sql`(status = 'PUBLISHED') = (effective_on IS NOT NULL AND published_at IS NOT NULL)`,
    ),
    // One draft per thing sold, and one published price per thing and date.
    uniqueIndex('prices_one_draft')
      .on(
        table.kind,
        sql`coalesce(plan_id, module_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(pack_size, 0)`,
      )
      .where(sql`status = 'DRAFT'`),
    uniqueIndex('prices_one_per_day')
      .on(
        table.kind,
        sql`coalesce(plan_id, module_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(pack_size, 0)`,
        table.effectiveOn,
      )
      .where(sql`status = 'PUBLISHED'`),
    index('prices_lookup').on(table.kind, table.planId, table.moduleId, table.effectiveOn),
  ],
);

// The trigger that enforces PRICE_TRANSITIONS; migration 0049 holds its output.
export const priceStatusTriggerBody = (): string =>
  transitionTriggerBody('Price', PRICE_STATUSES, PRICE_TRANSITIONS);
