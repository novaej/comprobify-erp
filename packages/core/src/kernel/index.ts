export { fixedClock, systemClock, type Clock } from './clock';
export type { ActorContext, PlatformActor, TenantMode } from './context';
export { DomainError, isDomainError, type DomainErrorDetails } from './errors';
export { startOfEcuadorMonth } from './ecuador-time';
export {
  hasFeature,
  limitOf,
  requireFeature,
  requireWithinLimit,
  type Entitlements,
} from './entitlements';
export { requirePermission } from './permissions';
