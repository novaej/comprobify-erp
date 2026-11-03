import type { MODULE_STATUSES, PLAN_STATUSES } from '@comprobify/db';
import type { BooleanFeature, LimitFeature } from './features';

export type ModuleStatus = (typeof MODULE_STATUSES)[number];
export type PlanStatus = (typeof PLAN_STATUSES)[number];

type ModuleSeed = {
  key: string;
  nameEs: string;
  nameEn: string;
  status: ModuleStatus;
  isBase?: true;
  features: BooleanFeature[];
};

export type PlanLimits = Record<
  'DOCUMENT_QUOTA' | 'USERS' | 'MAX_BRANCHES' | 'MAX_ISSUE_POINTS_PER_BRANCH',
  number | null
> &
  Partial<Record<LimitFeature, number | null>>;

type PlanSeed = {
  key: string;
  nameEs: string;
  nameEn: string;
  status: PlanStatus;
  selfService: boolean;
  modules: ModuleKey[];
  limits: PlanLimits;
};

// The starting catalog (ADR-011). Seeded once by key; after that the super admin
// edits it, so changing a row here doesn't change the database.
export const STARTING_MODULES = [
  {
    key: 'INVOICING',
    nameEs: 'Facturación',
    nameEn: 'Invoicing',
    status: 'AVAILABLE',
    isBase: true,
    features: [
      'DOC_TYPE_01',
      'CATALOG',
      'CLIENTS',
      'BUYER_EMAIL',
      'DOCUMENT_VOID',
      'REPORTS_BASIC',
      'EXTRA_SEATS',
      'DOCUMENT_PACKS',
    ],
  },
  {
    key: 'CREDIT_NOTES',
    nameEs: 'Notas de crédito',
    nameEn: 'Credit notes',
    status: 'AVAILABLE',
    features: ['DOC_TYPE_04'],
  },
  {
    key: 'DELIVERY_GUIDES',
    nameEs: 'Guías de remisión',
    nameEn: 'Delivery guides',
    status: 'COMING_SOON',
    features: ['DOC_TYPE_06'],
  },
  {
    key: 'BRANDING',
    nameEs: 'Marca',
    nameEn: 'Branding',
    status: 'AVAILABLE',
    features: ['RIDE_LOGO', 'DOCUMENT_TEMPLATES'],
  },
  {
    key: 'INVENTORY',
    nameEs: 'Inventario',
    nameEn: 'Inventory',
    status: 'AVAILABLE',
    features: ['INVENTORY'],
  },
  {
    key: 'PURCHASING',
    nameEs: 'Compras',
    nameEn: 'Purchasing',
    status: 'AVAILABLE',
    features: ['PURCHASE_ORDERS', 'PROVIDERS'],
  },
  {
    key: 'SALES',
    nameEs: 'Ventas',
    nameEn: 'Sales',
    status: 'AVAILABLE',
    features: ['SALE_ORDERS', 'RECEIVABLES'],
  },
  {
    key: 'BULK_INVOICING',
    nameEs: 'Facturación masiva',
    nameEn: 'Bulk invoicing',
    status: 'AVAILABLE',
    features: ['BULK_INVOICING'],
  },
  {
    key: 'ADVANCED_REPORTS',
    nameEs: 'Reportes avanzados',
    nameEn: 'Advanced reports',
    status: 'AVAILABLE',
    features: ['REPORTS_ADVANCED'],
  },
  {
    key: 'WITHHOLDINGS',
    nameEs: 'Retenciones',
    nameEn: 'Withholdings',
    status: 'COMING_SOON',
    features: ['DOC_TYPE_07', 'PROVIDERS'],
  },
  {
    key: 'PURCHASE_SETTLEMENTS',
    nameEs: 'Liquidaciones de compra',
    nameEn: 'Purchase settlements',
    status: 'COMING_SOON',
    features: ['DOC_TYPE_03', 'PROVIDERS'],
  },
  {
    key: 'RECEIVED_DOCUMENTS',
    nameEs: 'Comprobantes recibidos',
    nameEn: 'Received documents',
    status: 'COMING_SOON',
    features: ['RECEIVED_DOCS_IMPORT', 'PROVIDERS'],
  },
  {
    key: 'API_INTEGRATION',
    nameEs: 'Integración API',
    nameEn: 'API integration',
    status: 'COMING_SOON',
    features: ['API_ACCESS', 'API_KEYS', 'WEBHOOKS'],
  },
  {
    key: 'AI_ASSISTANTS',
    nameEs: 'Asistentes IA',
    nameEn: 'AI assistants',
    status: 'COMING_SOON',
    features: ['MCP_READ', 'MCP_WRITE'],
  },
] as const satisfies readonly ModuleSeed[];

export type ModuleKey = (typeof STARTING_MODULES)[number]['key'];

const STARTER: ModuleKey[] = ['INVOICING', 'CREDIT_NOTES', 'BRANDING'];
const BUSINESS: ModuleKey[] = [...STARTER, 'INVENTORY', 'PURCHASING', 'SALES'];
const API: ModuleKey[] = ['INVOICING', 'CREDIT_NOTES', 'API_INTEGRATION'];
const apiPlan = (documents: number, es: string, en: string): PlanSeed => ({
  key: `API_${documents}`,
  nameEs: `Integración ${es}`,
  nameEn: `Integration ${en}`,
  // Drafts until the API ships after the MVP.
  status: 'DRAFT',
  selfService: true,
  modules: API,
  limits: { DOCUMENT_QUOTA: documents, USERS: 3, MAX_BRANCHES: 3, MAX_ISSUE_POINTS_PER_BRANCH: 5 },
});

// Limits are placeholders until prices are set (Milestone 8).
export const STARTING_PLANS: readonly PlanSeed[] = [
  {
    key: 'FREE',
    nameEs: 'Gratis',
    nameEn: 'Free',
    status: 'PUBLISHED',
    selfService: true,
    modules: ['INVOICING'],
    limits: { DOCUMENT_QUOTA: 5, USERS: 1, MAX_BRANCHES: 1, MAX_ISSUE_POINTS_PER_BRANCH: 1 },
  },
  {
    key: 'STARTER',
    nameEs: 'Emprende',
    nameEn: 'Starter',
    status: 'PUBLISHED',
    selfService: true,
    modules: STARTER,
    limits: { DOCUMENT_QUOTA: 50, USERS: 2, MAX_BRANCHES: 1, MAX_ISSUE_POINTS_PER_BRANCH: 1 },
  },
  {
    key: 'BUSINESS',
    nameEs: 'Negocio',
    nameEn: 'Business',
    status: 'PUBLISHED',
    selfService: true,
    modules: BUSINESS,
    limits: { DOCUMENT_QUOTA: 300, USERS: 5, MAX_BRANCHES: 3, MAX_ISSUE_POINTS_PER_BRANCH: 2 },
  },
  {
    key: 'ENTERPRISE',
    nameEs: 'Empresa',
    nameEn: 'Enterprise',
    status: 'PUBLISHED',
    selfService: true,
    modules: [...BUSINESS, 'DELIVERY_GUIDES', 'BULK_INVOICING', 'ADVANCED_REPORTS'],
    limits: {
      DOCUMENT_QUOTA: 2000,
      USERS: 10,
      MAX_BRANCHES: null,
      MAX_ISSUE_POINTS_PER_BRANCH: null,
    },
  },
  apiPlan(500, '500', '500'),
  apiPlan(2000, '2.000', '2,000'),
  apiPlan(10000, '10.000', '10,000'),
  {
    key: 'CUSTOM',
    nameEs: 'Personalizado',
    nameEn: 'Custom',
    status: 'PUBLISHED',
    selfService: false,
    // The operator adds modules and limits per company as subscription items.
    modules: ['INVOICING'],
    limits: { DOCUMENT_QUOTA: 5, USERS: 1, MAX_BRANCHES: 1, MAX_ISSUE_POINTS_PER_BRANCH: 1 },
  },
];
