import type { TENANT_MODES } from '@comprobify/db';
import type { Clock } from './clock';

// The same list as the database CHECK (CLAUDE.md rule 17).
export type TenantMode = (typeof TENANT_MODES)[number];

// NFR-ARCH-1: every core function takes this first.
export type ActorContext = {
  tenantId: string;
  tenantMode: TenantMode;
  permissions: readonly string[];
  // null means no restriction (FR-ROLE-2).
  issuePointIds: readonly string[] | null;
  clock: Clock;
} & ({ userId: string; apiKeyId?: never } | { apiKeyId: string; userId?: never });

// The platform operator, outside any tenant (ADR-010, FR-ADM-1 to FR-ADM-5).
export type PlatformActor = { userId: string; isSuperAdmin: true; clock: Clock };
