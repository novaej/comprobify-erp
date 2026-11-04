import { MEMBERSHIP_ROLES } from '@comprobify/db';

export type Role = (typeof MEMBERSHIP_ROLES)[number];
export const ROLES = MEMBERSHIP_ROLES;

export const PERMISSIONS = [
  'organization.manage',
  'organization.go_live',
  'organization.accept_agreements',
  'organization.transfer_ownership',
  'organization.reset_twin',
  'users.read',
  'users.manage',
  'billing.read',
  'billing.manage',
  'certificates.manage',
  'catalog.read',
  'catalog.manage',
  'clients.read',
  'clients.manage',
  'providers.manage',
  'sales.read',
  'sales.manage',
  'documents.read',
  'documents.issue',
  'documents.void',
  'purchasing.read',
  'purchasing.manage',
  'inventory.read',
  'inventory.adjust',
  'reports.read',
  'reports.export',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READS = PERMISSIONS.filter((permission) => permission.endsWith('.read'));

// FR-ROLE-1: fixed sets per role; custom roles are post-MVP. PRD section 3.
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS.filter(
    (permission) =>
      ![
        'organization.go_live',
        'organization.accept_agreements',
        'organization.transfer_ownership',
      ].includes(permission),
  ),
  SALES: [
    'catalog.read',
    'catalog.manage',
    'clients.read',
    'clients.manage',
    'sales.read',
    'sales.manage',
    'documents.read',
    'documents.issue',
    'inventory.read',
    'reports.read',
  ],
  // Retenciones and liquidaciones are documents, so this role issues too.
  PURCHASING: [
    'catalog.read',
    'providers.manage',
    'purchasing.read',
    'purchasing.manage',
    'inventory.read',
    'inventory.adjust',
    'documents.read',
    'documents.issue',
    'reports.read',
  ],
  ACCOUNTANT: [...READS, 'reports.export'],
  VIEWER: READS.filter(
    (permission) => !['users.read', 'billing.read', 'audit.read'].includes(permission),
  ),
};

export const permissionsFor = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role];
