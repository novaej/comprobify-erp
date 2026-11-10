import { eq, schema, type SubscriptionStatus, type Tx } from '@comprobify/db';
import { ecuadorDate } from '../kernel';
import { quotaWindow, type SubscriptionPeriod } from './periods';

// Where a new company starts and an expired subscription lands (ADR-011).
export const DEFAULT_PLAN_KEY = 'FREE';

export type CompanyTenants = { realTenantId: string; twinTenantId: string };

// The default plan for each company and its twin, in the caller's transaction.
// A tenant that already has a subscription keeps it, so this is safe to repeat.
// Its period starts on the Ecuador date it is created, unbilled, so its quota renews monthly
// from that day (ADR-028).
export async function startDefaultSubscriptions(
  tx: Tx['db'],
  companies: CompanyTenants[],
  today: string,
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
        { tenantId: company.realTenantId, planId: plan.id, periodStart: today },
        { tenantId: company.twinTenantId, planId: plan.id, periodStart: today },
      ]),
    )
    .onConflictDoNothing({ target: subscriptions.tenantId })
    .returning({ id: subscriptions.id });
  return started.length;
}

export type SubscriptionState = SubscriptionPeriod & {
  status: SubscriptionStatus;
  window: ReturnType<typeof quotaWindow>;
};

// The tenant's subscription as billing and the quota see it, on `now` (Ecuador time). Filters
// by tenant_id itself, so it also works in system context.
export async function subscriptionState(
  tx: Tx['db'],
  tenantId: string,
  now: Date,
): Promise<SubscriptionState> {
  const { subscriptions } = schema;
  const [row] = await tx
    .select({
      interval: subscriptions.interval,
      status: subscriptions.status,
      periodStart: subscriptions.periodStart,
      periodEnd: subscriptions.periodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId));
  // Every company gets one when created, and the migrate step fills any gap.
  if (!row) throw new Error(`Tenant ${tenantId} has no subscription`);
  return { ...row, window: quotaWindow(row, ecuadorDate(now)) };
}
