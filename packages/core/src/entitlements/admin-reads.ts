import { and, asc, eq, inArray, schema, type SUBSCRIPTION_BILLING, type Tx } from '@comprobify/db';
import type { Entitlements } from '../kernel';
import { loadEntitlements } from './resolve';
import type { CompanyTenants } from './subscriptions';

// Reads for the super admin area, in the caller's system-context transaction.

type Names = { nameEs: string; nameEn: string };
type Billing = (typeof SUBSCRIPTION_BILLING)[number];

export type SubscriptionSummary = { planKey: string; plan: Names; billing: Billing };

export async function subscriptionSummaries(
  tx: Tx['db'],
  tenantIds: string[],
): Promise<Map<string, SubscriptionSummary>> {
  if (tenantIds.length === 0) return new Map();
  const { subscriptions, plans } = schema;
  const rows = await tx
    .select({
      tenantId: subscriptions.tenantId,
      planKey: plans.key,
      nameEs: plans.nameEs,
      nameEn: plans.nameEn,
      billing: subscriptions.billing,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(subscriptions.tenantId, tenantIds));
  return new Map(
    rows.map((row) => [
      row.tenantId,
      {
        planKey: row.planKey,
        plan: { nameEs: row.nameEs, nameEn: row.nameEn },
        billing: row.billing,
      },
    ]),
  );
}

export type CompanyPlanDetail = SubscriptionSummary & {
  complimentaryReason: string | null;
  negotiatedMonthlyPrice: string | null;
  addOns: (Names & { key: string; removesAt: Date | null })[];
  limits: { featureKey: string; value: number | null }[];
  overrides: {
    featureKey: string;
    effect: 'GRANT' | 'REVOKE' | 'LIMIT';
    limitValue: number | null;
    reason: string;
    createdAt: Date;
  }[];
  entitlements: Entitlements;
};

// Read from the real company; the twin mirrors it.
export async function companyPlanDetail(
  tx: Tx['db'],
  company: CompanyTenants,
  now: Date,
): Promise<CompanyPlanDetail> {
  const { subscriptions, plans, subscriptionItems, modules, tenantFeatureOverrides } = schema;
  const tenantId = company.realTenantId;
  const [subscription] = await tx
    .select({
      id: subscriptions.id,
      planKey: plans.key,
      nameEs: plans.nameEs,
      nameEn: plans.nameEn,
      billing: subscriptions.billing,
      complimentaryReason: subscriptions.complimentaryReason,
      negotiatedMonthlyPrice: subscriptions.negotiatedMonthlyPrice,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.tenantId, tenantId));
  if (!subscription) throw new Error(`Tenant ${tenantId} has no subscription`);
  const active = and(
    eq(subscriptionItems.subscriptionId, subscription.id),
    eq(subscriptionItems.active, true),
  );
  const addOns = await tx
    .select({
      key: modules.key,
      nameEs: modules.nameEs,
      nameEn: modules.nameEn,
      removesAt: subscriptionItems.removesAt,
    })
    .from(subscriptionItems)
    .innerJoin(modules, eq(modules.id, subscriptionItems.moduleId))
    .where(and(active, eq(subscriptionItems.kind, 'MODULE')))
    .orderBy(asc(modules.sortOrder));
  const limits = await tx
    .select({ featureKey: subscriptionItems.featureKey, value: subscriptionItems.limitValue })
    .from(subscriptionItems)
    .where(and(active, eq(subscriptionItems.kind, 'LIMIT')));
  const overrides = await tx
    .select({
      featureKey: tenantFeatureOverrides.featureKey,
      effect: tenantFeatureOverrides.effect,
      limitValue: tenantFeatureOverrides.limitValue,
      reason: tenantFeatureOverrides.reason,
      createdAt: tenantFeatureOverrides.createdAt,
    })
    .from(tenantFeatureOverrides)
    .where(
      and(eq(tenantFeatureOverrides.tenantId, tenantId), eq(tenantFeatureOverrides.active, true)),
    )
    .orderBy(asc(tenantFeatureOverrides.featureKey));
  return {
    planKey: subscription.planKey,
    plan: { nameEs: subscription.nameEs, nameEn: subscription.nameEn },
    billing: subscription.billing,
    complimentaryReason: subscription.complimentaryReason,
    negotiatedMonthlyPrice: subscription.negotiatedMonthlyPrice,
    addOns,
    limits: limits.map((row) => ({ featureKey: row.featureKey!, value: row.value })),
    overrides,
    entitlements: await loadEntitlements(tx, tenantId, now),
  };
}

export type CatalogChoices = {
  plans: (Names & { key: string; selfService: boolean })[];
  modules: (Names & { key: string })[];
};

// What the operator can choose for a company: published plans, sellable modules.
export async function catalogChoices(tx: Tx['db']): Promise<CatalogChoices> {
  const { plans, modules } = schema;
  const planRows = await tx
    .select({
      key: plans.key,
      nameEs: plans.nameEs,
      nameEn: plans.nameEn,
      selfService: plans.selfService,
    })
    .from(plans)
    .where(eq(plans.status, 'PUBLISHED'))
    .orderBy(asc(plans.sortOrder));
  const moduleRows = await tx
    .select({ key: modules.key, nameEs: modules.nameEs, nameEn: modules.nameEn })
    .from(modules)
    .where(and(eq(modules.status, 'AVAILABLE'), eq(modules.isBase, false)))
    .orderBy(asc(modules.sortOrder));
  return { plans: planRows, modules: moduleRows };
}
