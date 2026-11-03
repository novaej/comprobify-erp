import { and, eq, schema, type Tx } from '@comprobify/db';
import { startOfEcuadorMonth, type Entitlements } from '../kernel';
import type { ModuleStatus } from './catalog';

export type ModuleSource = {
  status: ModuleStatus;
  // A dated removal: of the plan's link, or of the add-on item.
  removesAt: Date | null;
  features: { key: string; removesAt: Date | null }[];
};

export type EntitlementSources = {
  planModules: ModuleSource[];
  itemModules: ModuleSource[];
  planLimits: Record<string, number | null>;
  itemLimits: Record<string, number | null>;
  overrides: { key: string; effect: 'GRANT' | 'REVOKE' | 'LIMIT'; limitValue: number | null }[];
};

// A removal is dated ahead and reaches the tenant at its first period start after
// that date, so a link counts while it was still there when the period began.
const present = (removesAt: Date | null, periodStart: Date) =>
  removesAt === null || removesAt > periodStart;

// ADR-011: override, then subscription items, then the plan, then off. A coming-soon
// module grants nothing until it is available.
export function resolveEntitlements(sources: EntitlementSources, periodStart: Date): Entitlements {
  const features = new Set<string>();
  for (const module of [...sources.planModules, ...sources.itemModules]) {
    if (module.status !== 'AVAILABLE' || !present(module.removesAt, periodStart)) continue;
    for (const feature of module.features)
      if (present(feature.removesAt, periodStart)) features.add(feature.key);
  }
  const limits = { ...sources.planLimits, ...sources.itemLimits };
  for (const override of sources.overrides) {
    if (override.effect === 'GRANT') features.add(override.key);
    else if (override.effect === 'REVOKE') features.delete(override.key);
    else limits[override.key] = override.limitValue;
  }
  return { features: [...features].sort(), limits };
}

// Until billing has periods (Milestone 8), the period is the Ecuador calendar month.
export function currentPeriodStart(now: Date): Date {
  return startOfEcuadorMonth(now);
}

// Filters by tenant_id itself, so it also works in system context.
export async function loadEntitlements(
  tx: Tx['db'],
  tenantId: string,
  now: Date,
): Promise<Entitlements> {
  const { subscriptions, subscriptionItems, planModules, planLimits, modules, moduleFeatures } =
    schema;
  const [subscription] = await tx
    .select({ id: subscriptions.id, planId: subscriptions.planId })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId));
  // Every company gets one when created, and the migrate step fills any gap.
  if (!subscription) throw new Error(`Tenant ${tenantId} has no subscription`);

  // The catalog is small platform data: read it whole.
  const allModules = await tx.select({ id: modules.id, status: modules.status }).from(modules);
  const allKeys = await tx
    .select({
      moduleId: moduleFeatures.moduleId,
      key: moduleFeatures.featureKey,
      removesAt: moduleFeatures.removesAt,
    })
    .from(moduleFeatures);
  const featuresOf = (moduleId: string) =>
    allKeys
      .filter((row) => row.moduleId === moduleId)
      .map((row) => ({ key: row.key, removesAt: row.removesAt }));

  const fromPlan = await tx
    .select({ moduleId: planModules.moduleId, removesAt: planModules.removesAt })
    .from(planModules)
    .where(eq(planModules.planId, subscription.planId));
  const items = await tx
    .select({
      kind: subscriptionItems.kind,
      moduleId: subscriptionItems.moduleId,
      featureKey: subscriptionItems.featureKey,
      limitValue: subscriptionItems.limitValue,
      removesAt: subscriptionItems.removesAt,
    })
    .from(subscriptionItems)
    .where(
      and(
        eq(subscriptionItems.tenantId, tenantId),
        eq(subscriptionItems.subscriptionId, subscription.id),
        eq(subscriptionItems.active, true),
      ),
    );
  const moduleSource = (moduleId: string, removesAt: Date | null): ModuleSource => ({
    status: allModules.find((row) => row.id === moduleId)!.status,
    removesAt,
    features: featuresOf(moduleId),
  });

  const limitRows = await tx
    .select({ key: planLimits.featureKey, value: planLimits.value })
    .from(planLimits)
    .where(eq(planLimits.planId, subscription.planId));
  const overrides = await tx
    .select({
      key: schema.tenantFeatureOverrides.featureKey,
      effect: schema.tenantFeatureOverrides.effect,
      limitValue: schema.tenantFeatureOverrides.limitValue,
    })
    .from(schema.tenantFeatureOverrides)
    .where(
      and(
        eq(schema.tenantFeatureOverrides.tenantId, tenantId),
        eq(schema.tenantFeatureOverrides.active, true),
      ),
    );

  return resolveEntitlements(
    {
      planModules: fromPlan.map((row) => moduleSource(row.moduleId, row.removesAt)),
      itemModules: items.flatMap((item) =>
        item.kind === 'MODULE' ? [moduleSource(item.moduleId!, item.removesAt)] : [],
      ),
      planLimits: Object.fromEntries(limitRows.map((row) => [row.key, row.value])),
      itemLimits: Object.fromEntries(
        items
          .filter((item) => item.kind === 'LIMIT')
          .map((item) => [item.featureKey!, item.limitValue]),
      ),
      overrides,
    },
    currentPeriodStart(now),
  );
}
