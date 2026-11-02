import { and, eq, schema, type Database } from '@comprobify/db';
import type { ActorContext } from '../kernel';

// Warn this many days ahead, the first of the PRD's reminders (FR-NOT-2).
export const CERTIFICATE_WARNING_DAYS = 30;

export type CertificateStatus =
  { state: 'ok' | 'expiring' | 'expired'; notAfter: Date; daysLeft: number } | { state: 'missing' };

// For the certificate banner: the active certificate of the actor's tenant.
export async function certificateStatus(
  db: Database,
  ctx: ActorContext,
): Promise<CertificateStatus> {
  const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select({ notAfter: schema.certificates.notAfter })
      .from(schema.certificates)
      .where(
        and(eq(schema.certificates.tenantId, ctx.tenantId), eq(schema.certificates.active, true)),
      ),
  );
  if (!row) return { state: 'missing' };
  const daysLeft = Math.floor((row.notAfter.getTime() - ctx.clock.now().getTime()) / 86_400_000);
  const state = daysLeft < 0 ? 'expired' : daysLeft <= CERTIFICATE_WARNING_DAYS ? 'expiring' : 'ok';
  return { state, notAfter: row.notAfter, daysLeft };
}
