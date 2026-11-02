import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { oneOf } from './checks';
import { users } from './identity';

// The single source for these values: CHECKs below and core both use them.
export const TENANT_MODES = ['TEST', 'PRODUCTION'] as const;
export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export const MEMBERSHIP_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
  'PURCHASING',
  'ACCOUNTANT',
  'VIEWER',
] as const;

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();
const code = (name: string) => text(name).notNull();

// PRD 7.4: a test twin is another row, linked by twin_of. RLS: ADR-010.
export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    ruc: text('ruc').notNull(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    mainAddress: text('main_address').notNull(),
    mode: text('mode', { enum: TENANT_MODES }).notNull(),
    twinOf: uuid('twin_of').references((): AnyPgColumn => tenants.id),
    status: text('status', { enum: TENANT_STATUSES }).default('ACTIVE').notNull(),
    idleTimeoutMinutes: integer('idle_timeout_minutes').default(30).notNull(),
    // obligadoContabilidad in the SRI XML.
    requiredAccounting: boolean('required_accounting').default(false).notNull(),
    // Members must use TOTP to work here (FR-USR-3); mirrored in the twin.
    requireTwoFactor: boolean('require_two_factor').default(false).notNull(),
    // Set by go-live; a real organization can't issue before it (FR-ONB-5).
    liveAt: timestamp('live_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('tenants_ruc_mode_unique').on(table.ruc, table.mode),
    check('tenants_ruc_check', sql`${table.ruc} ~ '^[0-9]{13}$'`),
    check('tenants_mode_check', oneOf('mode', TENANT_MODES)),
    check('tenants_status_check', oneOf('status', TENANT_STATUSES)),
    // Only a twin points at another tenant, and every twin does.
    check('tenants_twin_check', sql`(${table.mode} = 'TEST') = (${table.twinOf} IS NOT NULL)`),
    check('tenants_idle_timeout_check', sql`${table.idleTimeoutMinutes} BETWEEN 5 AND 480`),
  ],
);

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: code('code'),
    name: text('name').notNull(),
    address: text('address').notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('branches_tenant_code_unique').on(table.tenantId, table.code),
    // Target for child foreign keys, so a child can't point into another tenant.
    unique('branches_tenant_id_unique').on(table.tenantId, table.id),
    check('branches_code_check', sql`${table.code} ~ '^[0-9]{3}$'`),
  ],
);

export const issuePoints = pgTable(
  'issue_points',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    code: code('code'),
    // The pause switch checked before issuing (FR-DOC-4).
    canIssue: boolean('can_issue').default(true).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'issue_points_branch_fk',
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    unique('issue_points_branch_code_unique').on(table.branchId, table.code),
    // Target for child foreign keys, so a child can't point into another tenant.
    unique('issue_points_tenant_id_unique').on(table.tenantId, table.id),
    check('issue_points_code_check', sql`${table.code} ~ '^[0-9]{3}$'`),
  ],
);

// One warehouse per branch in the MVP (PRD glossary).
export const warehouses = pgTable(
  'warehouses',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    name: text('name').notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'warehouses_branch_fk',
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    unique('warehouses_branch_unique').on(table.branchId),
  ],
);

// Twins hold mirrored rows (ADR-010). RLS also admits the user's own rows.
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: MEMBERSHIP_ROLES }).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('memberships_tenant_user_unique').on(table.tenantId, table.userId),
    // The user-context lookup: which organizations does this user belong to?
    index('memberships_user_id_idx').on(table.userId),
    check('memberships_role_check', oneOf('role', MEMBERSHIP_ROLES)),
  ],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// FR-ONB-3: one row per upload, so renewals keep their history. The private key
// is AES-256-GCM encrypted; the certificate is public material.
export const certificates = pgTable(
  'certificates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    encryptedPrivateKey: text('encrypted_private_key').notNull(),
    certificatePem: text('certificate_pem').notNull(),
    fingerprint: text('fingerprint').notNull(),
    subjectName: text('subject_name').notNull(),
    issuerName: text('issuer_name').notNull(),
    notBefore: timestamp('not_before', { withTimezone: true }).notNull(),
    notAfter: timestamp('not_after', { withTimezone: true }).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // At most one certificate signs for a tenant at a time.
    uniqueIndex('certificates_one_active_idx')
      .on(table.tenantId)
      .where(sql`${table.active}`),
    check('certificates_fingerprint_check', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  ],
);

// Kept apart from tenants so the image isn't loaded with every tenant query.
export const tenantLogos = pgTable(
  'tenant_logos',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id),
    content: bytea('content').notNull(),
    contentType: text('content_type').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'tenant_logos_type_check',
      oneOf('content_type', ['image/png', 'image/jpeg', 'image/gif']),
    ),
    check('tenant_logos_size_check', sql`octet_length(${table.content}) <= 512000`),
  ],
);

// Roles that can be given by invitation or role change; ownership is transferred, never granted.
export const ASSIGNABLE_ROLES = MEMBERSHIP_ROLES.filter((role) => role !== 'OWNER');

// FR-USR-1. Held by the real organization; accepting creates the membership in it and its
// twin. Only a hash of the token is stored.
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull(),
    role: text('role', { enum: MEMBERSHIP_ROLES }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('invitations_role_check', oneOf('role', ASSIGNABLE_ROLES)),
    check('invitations_email_lowercase_check', sql`${table.email} = lower(${table.email})`),
    // One open invitation per email and organization.
    uniqueIndex('invitations_one_pending_idx')
      .on(table.tenantId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
  ],
);

// FR-ROLE-2. No active rows for a user means no restriction. Rows are switched off,
// never deleted (CLAUDE.md rule 12), and mirrored in the twin by branch and point code.
export const issuePointAccess = pgTable(
  'issue_point_access',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    issuePointId: uuid('issue_point_id').notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'issue_point_access_point_fk',
      columns: [table.tenantId, table.issuePointId],
      foreignColumns: [issuePoints.tenantId, issuePoints.id],
    }),
    unique('issue_point_access_unique').on(table.tenantId, table.userId, table.issuePointId),
  ],
);
