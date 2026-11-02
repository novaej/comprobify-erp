export { createDatabase } from './context';
export type { Database, DatabaseOptions, IdentityDb, TenantContext, Tx } from './context';
export * as schema from './schema';
export { MEMBERSHIP_ROLES, TENANT_MODES, TENANT_STATUSES } from './schema';
// Re-exported so callers share this package's drizzle-orm instance and types.
export { and, count, eq, gte, lt, sql } from 'drizzle-orm';
export { UnsafeDatabaseError, findUnprotectedTables } from './boot-guard';
export type { Queryable } from './boot-guard';
