import { schema, type Database } from '@comprobify/db';
import { STARTING_MODULES, STARTING_PLANS } from './catalog';
import { FEATURES, FEATURE_KEYS } from './features';

export { FEATURES, FEATURE_KEYS } from './features';
export type { BooleanFeature, FeatureKey, FeatureKind, LimitFeature } from './features';
export { STARTING_MODULES, STARTING_PLANS } from './catalog';
export type { ModuleKey, ModuleStatus, PlanLimits, PlanStatus } from './catalog';
export { DEFAULT_PLAN_KEY, startDefaultSubscriptions } from './subscriptions';
export type { CompanyTenants } from './subscriptions';
export { planOverview, SHOWN_LIMITS } from './overview';
export type { PlanModule, PlanOverview } from './overview';
export { currentPeriodStart, loadEntitlements, resolveEntitlements } from './resolve';
export type { EntitlementSources, ModuleSource } from './resolve';

export type CatalogSync = { features: string[]; modules: string[]; plans: string[] };

// The migrate step: new feature keys from the registry, then any starting module or
// plan missing by key. Existing rows are the super admin's and are never touched.
export async function syncCatalog(db: Database): Promise<CatalogSync> {
  return db.withSystem('sync the plan catalog from the repository', async ({ db: tx }) => {
    const { features, modules, moduleFeatures, plans, planModules, planLimits } = schema;

    const added = await tx
      .insert(features)
      .values(FEATURE_KEYS.map((key) => ({ key, kind: FEATURES[key] })))
      .onConflictDoNothing()
      .returning({ key: features.key });
    const stored = await tx.select().from(features);
    const changed = stored.filter(
      (row) => row.key in FEATURES && FEATURES[row.key as keyof typeof FEATURES] !== row.kind,
    );
    // Link tables reference (key, kind), so a kind can't change under them.
    if (changed.length > 0)
      throw new Error(`Feature kind changed in code: ${changed.map((row) => row.key).join(', ')}`);

    const addedModules: string[] = [];
    for (const [index, seed] of STARTING_MODULES.entries()) {
      const [row] = await tx
        .insert(modules)
        .values({
          key: seed.key,
          nameEs: seed.nameEs,
          nameEn: seed.nameEn,
          status: seed.status,
          isBase: 'isBase' in seed,
          sortOrder: index,
        })
        .onConflictDoNothing({ target: modules.key })
        .returning({ id: modules.id });
      if (!row) continue;
      await tx
        .insert(moduleFeatures)
        .values(seed.features.map((featureKey) => ({ moduleId: row.id, featureKey })));
      addedModules.push(seed.key);
    }

    const moduleIds = new Map(
      (await tx.select({ id: modules.id, key: modules.key }).from(modules)).map((row) => [
        row.key,
        row.id,
      ]),
    );
    const addedPlans: string[] = [];
    for (const [index, seed] of STARTING_PLANS.entries()) {
      const [row] = await tx
        .insert(plans)
        .values({
          key: seed.key,
          nameEs: seed.nameEs,
          nameEn: seed.nameEn,
          status: seed.status,
          selfService: seed.selfService,
          sortOrder: index,
        })
        .onConflictDoNothing({ target: plans.key })
        .returning({ id: plans.id });
      if (!row) continue;
      await tx
        .insert(planModules)
        .values(seed.modules.map((key) => ({ planId: row.id, moduleId: moduleIds.get(key)! })));
      await tx.insert(planLimits).values(
        Object.entries(seed.limits).map(([featureKey, value]) => ({
          planId: row.id,
          featureKey,
          value,
        })),
      );
      addedPlans.push(seed.key);
    }

    return { features: added.map((row) => row.key), modules: addedModules, plans: addedPlans };
  });
}
