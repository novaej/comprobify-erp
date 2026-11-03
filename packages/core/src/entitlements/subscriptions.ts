import { eq, schema, type Tx } from '@comprobify/db';

// Where a new company starts and an expired subscription lands (ADR-011).
export const DEFAULT_PLAN_KEY = 'FREE';

export type CompanyTenants = { realTenantId: string; twinTenantId: string };

// The default plan for each company and its twin, in the caller's transaction.
// A tenant that already has a subscription keeps it, so this is safe to repeat.
export async function startDefaultSubscriptions(
  tx: Tx['db'],
  companies: CompanyTenants[],
): Promise<number> {
  if (companies.length === 0) return 0;
  const { plans, subscriptions } = schema;
  const [plan] = await tx
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.key, DEFAULT_PLAN_KEY));
  // The migrate step seeds it; without it no company can be created.
  if (!plan) throw new Error(`Plan ${DEFAULT_PLAN_KEY} is missing: run the migrate step`);
  const started = await tx
    .insert(subscriptions)
    .values(
      companies.flatMap((company) => [
        { tenantId: company.realTenantId, planId: plan.id },
        { tenantId: company.twinTenantId, planId: plan.id },
      ]),
    )
    .onConflictDoNothing({ target: subscriptions.tenantId })
    .returning({ id: subscriptions.id });
  return started.length;
}
