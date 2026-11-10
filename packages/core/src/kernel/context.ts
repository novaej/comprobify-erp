import type { TENANT_MODES } from '@comprobify/db';
import type { Clock } from './clock';
import type { Entitlements } from './entitlements';

// The same list as the database CHECK (CLAUDE.md rule 17).
export type TenantMode = (typeof TENANT_MODES)[number];

// FR-BILL-5, FR-BILL-9: a past-due company only reads and pays; a suspended one only reads.
export type AccountStanding = 'GOOD' | 'PAST_DUE' | 'SUSPENDED';

// NFR-ARCH-1: every core function takes this first.
export type ActorContext = {
  tenantId: string;
  tenantMode: TenantMode;
  permissions: readonly string[];
  // null means no restriction (FR-ROLE-2).
  issuePointIds: readonly string[] | null;
  entitlements: Entitlements;
  standing: AccountStanding;
  clock: Clock;
} & ({ userId: string; apiKeyId?: never } | { apiKeyId: string; userId?: never });

// The platform operator, outside any tenant (ADR-010, FR-ADM-1 to FR-ADM-5).
export type PlatformActor = { userId: string; isSuperAdmin: true; clock: Clock };
