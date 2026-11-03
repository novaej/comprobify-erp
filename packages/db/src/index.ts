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
  OVERRIDE_EFFECTS,
  PLAN_STATUSES,
  SUBSCRIPTION_BILLING,
  SUBSCRIPTION_ITEM_KINDS,
  TENANT_MODES,
  TENANT_STATUSES,
} from './schema';
// Re-exported so callers share this package's drizzle-orm instance and types.
export { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
export { UnsafeDatabaseError, findUnprotectedTables } from './boot-guard';
export type { Queryable } from './boot-guard';
