import type { ActorContext } from './context';
import { DomainError } from './errors';

// What the tenant may use, resolved once per request (FR-PLAN-4, ADR-011).
// A limit missing from `limits` is 0; null is unlimited.
export type Entitlements = {
  features: readonly string[];
  limits: Readonly<Record<string, number | null>>;
};

export function hasFeature(ctx: ActorContext, key: string): boolean {
  return ctx.entitlements.features.includes(key);
}

export function limitOf(entitlements: Entitlements, key: string): number | null {
  return key in entitlements.limits ? (entitlements.limits[key] ?? null) : 0;
}

// Core enforces these; pages only hide or lock what they would refuse (FR-ROLE-3).
export function requireFeature(ctx: ActorContext, key: string): void {
  if (!hasFeature(ctx, key))
    throw new DomainError('FEATURE_NOT_ENABLED', `Feature ${key} is not enabled`, { feature: key });
}

// `used` is the count before the one being added.
export function requireWithinLimit(entitlements: Entitlements, key: string, used: number): void {
  const limit = limitOf(entitlements, key);
  if (limit !== null && used >= limit)
    throw new DomainError('LIMIT_REACHED', `Limit ${key} reached`, { feature: key, limit });
}
