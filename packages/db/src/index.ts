export { createDatabase } from './context';
export type { Database, DatabaseOptions, IdentityDb, TenantContext, Tx } from './context';
export * as schema from './schema';
export {
  AGREEMENT_TYPES,
  ASSIGNABLE_ROLES,
  AUDIT_ACTIONS,
  FEATURE_KINDS,
  MEMBERSHIP_ROLES,
  MODULE_STATUSES,
  PLAN_STATUSES,
  TENANT_MODES,
  TENANT_STATUSES,
} from './schema';
// Re-exported so callers share this package's drizzle-orm instance and types.
export { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
export { UnsafeDatabaseError, findUnprotectedTables } from './boot-guard';
export type { Queryable } from './boot-guard';
