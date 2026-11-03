import type { FEATURE_KINDS } from '@comprobify/db';

export type FeatureKind = (typeof FEATURE_KINDS)[number];

// ADR-011: the only layer in code, because core checks these keys. The migrate
// step syncs new ones to `features`; a key is never renamed or given another kind.
export const FEATURES = {
  // Limits, null = unlimited.
  DOCUMENT_QUOTA: 'LIMIT',
  USERS: 'LIMIT',
  MAX_BRANCHES: 'LIMIT',
  MAX_ISSUE_POINTS_PER_BRANCH: 'LIMIT',
  API_KEYS_MAX: 'LIMIT',
  WEBHOOK_ENDPOINTS_MAX: 'LIMIT',
  API_RATE_LIMIT: 'LIMIT',
  // Document types.
  DOC_TYPE_01: 'BOOLEAN',
  DOC_TYPE_04: 'BOOLEAN',
  DOC_TYPE_06: 'BOOLEAN',
  DOC_TYPE_07: 'BOOLEAN',
  DOC_TYPE_03: 'BOOLEAN',
  RECEIVED_DOCS_IMPORT: 'BOOLEAN',
  // ERP.
  CATALOG: 'BOOLEAN',
  CLIENTS: 'BOOLEAN',
  PROVIDERS: 'BOOLEAN',
  INVENTORY: 'BOOLEAN',
  MULTI_WAREHOUSE: 'BOOLEAN',
  PURCHASE_ORDERS: 'BOOLEAN',
  SALE_ORDERS: 'BOOLEAN',
  RECEIVABLES: 'BOOLEAN',
  BULK_INVOICING: 'BOOLEAN',
  REPORTS_BASIC: 'BOOLEAN',
  REPORTS_ADVANCED: 'BOOLEAN',
  DOCUMENT_TEMPLATES: 'BOOLEAN',
  // Other.
  BUYER_EMAIL: 'BOOLEAN',
  RIDE_LOGO: 'BOOLEAN',
  DOCUMENT_VOID: 'BOOLEAN',
  EXTRA_SEATS: 'BOOLEAN',
  DOCUMENT_PACKS: 'BOOLEAN',
  // Integration layer, after the MVP.
  API_ACCESS: 'BOOLEAN',
  API_KEYS: 'BOOLEAN',
  WEBHOOKS: 'BOOLEAN',
  MCP_READ: 'BOOLEAN',
  MCP_WRITE: 'BOOLEAN',
} as const satisfies Record<string, FeatureKind>;

export type FeatureKey = keyof typeof FEATURES;
export type BooleanFeature = {
  [K in FeatureKey]: (typeof FEATURES)[K] extends 'BOOLEAN' ? K : never;
}[FeatureKey];
export type LimitFeature = Exclude<FeatureKey, BooleanFeature>;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
