export { createDatabase } from './context';
export type { Database, DatabaseOptions, IdentityDb, TenantContext, Tx } from './context';
export * as schema from './schema';
export {
  AGREEMENT_TYPES,
  ASSIGNABLE_ROLES,
  AMBIENTES,
  AUDIT_ACTIONS,
  CLIENT_ID_TYPES,
  CONSUMER_FINAL_ID,
  DOCUMENT_EVENT_TYPES,
  DOCUMENT_STATUSES,
  DOCUMENT_TRANSITIONS,
  documentStatusTriggerBody,
  FEATURE_KINDS,
  MEMBERSHIP_ROLES,
  MODULE_STATUSES,
  OVERRIDE_EFFECTS,
  PLAN_STATUSES,
  PRODUCT_KINDS,
  PLATFORM_AUDIT_ACTIONS,
  SRI_DOCUMENT_TYPES,
  SRI_ID_TYPES,
  SRI_IVA_RATE_CODES,
  SRI_IVA_RATES,
  SRI_PAYMENT_METHODS,
  SRI_TAX_CODES,
  SRI_TERM_UNITS,
  SUBSCRIPTION_BILLING,
  SUBSCRIPTION_ITEM_KINDS,
  TAX_REGIMES,
  TENANT_MODES,
  TENANT_STATUSES,
} from './schema';
export type { DocumentStatus } from './schema';
// Re-exported so callers share this package's drizzle-orm instance and types.
export { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
export { UnsafeDatabaseError, findUnprotectedTables } from './boot-guard';
export type { Queryable } from './boot-guard';
