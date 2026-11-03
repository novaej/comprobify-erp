import type { ActorContext } from './context';
import { DomainError } from './errors';

// Core enforces permissions; pages only hide what this would refuse (FR-ROLE-3).
export function requirePermission(ctx: ActorContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) {
    throw new DomainError('FORBIDDEN', `Missing permission ${permission}`, { permission });
  }
}
