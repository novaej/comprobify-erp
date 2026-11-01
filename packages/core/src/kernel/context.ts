import type { Clock } from './clock';

export type TenantMode = 'TEST' | 'PRODUCTION';

// NFR-ARCH-1: every core function takes this first.
export type ActorContext = {
  tenantId: string;
  tenantMode: TenantMode;
  permissions: readonly string[];
  // null means no restriction (FR-ROLE-2).
  issuePointIds: readonly string[] | null;
  clock: Clock;
} & ({ userId: string; apiKeyId?: never } | { apiKeyId: string; userId?: never });
