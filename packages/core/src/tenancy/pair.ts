import { eq, schema, type Tx } from '@comprobify/db';
import { DomainError } from '../kernel';

export type Pair = { realTenantId: string; twinTenantId: string | null; name: string };

// The organization and its twin, from either one. System context only.
export async function pairOf(tx: Tx['db'], tenantId: string): Promise<Pair> {
  const { tenants } = schema;
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new DomainError('NOT_FOUND', 'Organization not found');
  const realTenantId = tenant.twinOf ?? tenant.id;
  const [real] =
    tenant.twinOf === null
      ? [tenant]
      : await tx.select().from(tenants).where(eq(tenants.id, realTenantId));
  const [twin] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.twinOf, realTenantId));
  return { realTenantId, twinTenantId: twin?.id ?? null, name: real!.tradeName ?? real!.legalName };
}
