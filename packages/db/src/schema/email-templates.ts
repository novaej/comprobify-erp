import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf, transitionTriggerBody } from './checks';
import { users } from './identity';

// FR-NOT-3, FR-ADM-4 (ADR-037). The emails the platform writes itself: the account emails and
// the notification emails. The CHECK below and core's placeholders and defaults all come from
// this list (rule 17). The buyer's copy of a document and the purchase order email are the
// company's own voice, with their own layout, and stay in code.
export const EMAIL_TEMPLATES = [
  'verifyEmail',
  'resetPassword',
  'invitation',
  'renewalDue',
  'graceStarted',
  'pastDue',
  'movedToFree',
  'paymentRepriced',
  'renewalRepriced',
  'paymentVerified',
  'paymentRejected',
  'documentRejected',
  'documentSendFailed',
  'documentOverdue',
  'batchCompleted',
  'certificateExpiring',
  'certificateExpired',
  'quotaNearing',
  'quotaReached',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATES)[number];

export const EMAIL_LOCALES = ['es', 'en'] as const;
export type EmailLocaleKey = (typeof EMAIL_LOCALES)[number];

// A draft is the super admin's work in progress; publishing freezes it and makes it the version
// in use. One that isn't wanted is discarded, never deleted (rule 12).
export const EMAIL_TEMPLATE_STATUSES = ['DRAFT', 'PUBLISHED', 'DISCARDED'] as const;
export type EmailTemplateStatus = (typeof EMAIL_TEMPLATE_STATUSES)[number];
export const EMAIL_TEMPLATE_TRANSITIONS: Record<
  EmailTemplateStatus,
  readonly EmailTemplateStatus[]
> = {
  DRAFT: ['PUBLISHED', 'DISCARDED'],
  PUBLISHED: [],
  DISCARDED: [],
};

// The trigger that enforces EMAIL_TEMPLATE_TRANSITIONS; migration 0060 holds its output.
export const emailTemplateStatusTriggerBody = (): string =>
  transitionTriggerBody('Email template', EMAIL_TEMPLATE_STATUSES, EMAIL_TEMPLATE_TRANSITIONS);

// Platform data, written in system context only. The copy is structured (subject, heading, body,
// button label, footer); the layout is code, so a text can't break an email or inject markup.
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    template: text('template', { enum: EMAIL_TEMPLATES }).notNull(),
    locale: text('locale', { enum: EMAIL_LOCALES }).notNull(),
    // Per template and language, never reused, discarded drafts included.
    version: integer('version').notNull(),
    status: text('status', { enum: EMAIL_TEMPLATE_STATUSES }).default('DRAFT').notNull(),
    subject: text('subject').notNull(),
    heading: text('heading').notNull(),
    body: text('body').notNull(),
    button: text('button').notNull(),
    footer: text('footer').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    unique('email_templates_version_unique').on(table.template, table.locale, table.version),
    // One draft at a time per template and language.
    uniqueIndex('email_templates_one_draft')
      .on(table.template, table.locale)
      .where(sql`status = 'DRAFT'`),
    index('email_templates_in_use').on(table.template, table.locale, table.version),
    check('email_templates_template_check', oneOf('template', EMAIL_TEMPLATES)),
    check('email_templates_locale_check', oneOf('locale', EMAIL_LOCALES)),
    check('email_templates_status_check', oneOf('status', EMAIL_TEMPLATE_STATUSES)),
    check('email_templates_version_check', sql`version >= 1`),
    check(
      'email_templates_published_check',
      sql`(status = 'PUBLISHED') = (published_at IS NOT NULL)`,
    ),
    // A subject is a header: one line.
    check('email_templates_subject_check', sql`subject !~ E'[\\r\\n]' AND length(subject) <= 200`),
    check(
      'email_templates_lengths_check',
      sql`length(heading) <= 200 AND length(body) <= 2000 AND length(button) <= 60 AND length(footer) <= 500`,
    ),
    check(
      'email_templates_filled_check',
      sql`length(trim(subject)) > 0 AND length(trim(heading)) > 0 AND length(trim(body)) > 0 AND length(trim(button)) > 0`,
    ),
  ],
);
