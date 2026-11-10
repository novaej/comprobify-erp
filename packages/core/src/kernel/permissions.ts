import type { ActorContext } from './context';
import { DomainError } from './errors';

// Reading and exporting change nothing, so no standing blocks them.
export const isWrite = (permission: string): boolean =>
  !permission.endsWith('.read') && permission !== 'reports.export';

// Core enforces permissions; pages only hide what this would refuse (FR-ROLE-3). The write block
// rides on it, so every write a role can make stops for a company that may not write.
export function requirePermission(ctx: ActorContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) {
    throw new DomainError('FORBIDDEN', `Missing permission ${permission}`, { permission });
  }
  if (!isWrite(permission)) return;
  if (ctx.standing === 'SUSPENDED')
    throw new DomainError('ACCOUNT_SUSPENDED', 'This company is suspended', { permission });
  // FR-BILL-5: past due blocks writes but lets the company pay.
  if (ctx.standing === 'PAST_DUE' && !permission.startsWith('billing.'))
    throw new DomainError('ACCOUNT_PAST_DUE', 'Pay the renewal to keep working', { permission });
}
