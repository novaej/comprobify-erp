import type { OrganizationEntry } from './organizations';

export type ActiveOrganization = {
  entry: OrganizationEntry;
  tenantId: string;
  mode: 'TEST' | 'PRODUCTION';
};

// The session's choice when it is still one of the user's organizations; otherwise
// the first organization, in production once it is live, in its test twin before.
export function chooseActiveOrganization(
  organizations: readonly OrganizationEntry[],
  sessionTenantId: string | null,
): ActiveOrganization | null {
  for (const entry of organizations) {
    if (entry.twinTenantId && sessionTenantId === entry.twinTenantId) {
      return { entry, tenantId: entry.twinTenantId, mode: 'TEST' };
    }
    // Before go-live the real organization can't issue, so it isn't offered (FR-ONB-5).
    if (sessionTenantId === entry.realTenantId && entry.live) {
      return { entry, tenantId: entry.realTenantId, mode: 'PRODUCTION' };
    }
  }
  const first = organizations[0];
  if (!first) return null;
  if (first.live || !first.twinTenantId)
    return { entry: first, tenantId: first.realTenantId, mode: 'PRODUCTION' };
  return { entry: first, tenantId: first.twinTenantId, mode: 'TEST' };
}
