import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { oneOf } from './checks';
import { users } from './identity';
import { tenants } from './tenancy';

export const AGREEMENT_TYPES = ['TERMS', 'PRIVACY', 'DPA'] as const;

// FR-ONB-8. Platform data, no tenant_id: the migrate step publishes a new version
// when a text in the repo changes. The app role can only read it.
export const agreementTemplates = pgTable(
  'agreement_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    documentType: text('document_type', { enum: AGREEMENT_TYPES }).notNull(),
    version: integer('version').notNull(),
    contentMarkdown: text('content_markdown').notNull(),
    contentHash: text('content_hash').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('agreement_templates_type_version_unique').on(table.documentType, table.version),
    check('agreement_templates_type_check', oneOf('document_type', AGREEMENT_TYPES)),
  ],
);

// One row per accepted version, append-only: the exact personalized text the company
// accepted, and who accepted it from where (legal evidence).
export const agreementAcceptances = pgTable(
  'agreement_acceptances',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => agreementTemplates.id),
    documentType: text('document_type', { enum: AGREEMENT_TYPES }).notNull(),
    version: integer('version').notNull(),
    contentMarkdown: text('content_markdown').notNull(),
    contentHash: text('content_hash').notNull(),
    acceptedBy: uuid('accepted_by')
      .notNull()
      .references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    unique('agreement_acceptances_tenant_template_unique').on(table.tenantId, table.templateId),
    check('agreement_acceptances_type_check', oneOf('document_type', AGREEMENT_TYPES)),
  ],
);
