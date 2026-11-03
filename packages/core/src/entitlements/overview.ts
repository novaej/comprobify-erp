import { and, eq, schema, type Database, type SUBSCRIPTION_BILLING } from '@comprobify/db';
import { limitOf, requirePermission, type ActorContext } from '../kernel';
import { currentPeriodStart } from './resolve';
import type { ModuleStatus } from './catalog';

export type PlanModule = {
  key: string;
  nameEs: string;
  nameEn: string;
  status: ModuleStatus;
  source: 'PLAN' | 'ADD_ON';
  // A dated removal from the plan, shown so the company sees it coming.
  removesAt: Date | null;
};

export const SHOWN_LIMITS = [
  'DOCUMENT_QUOTA',
  'USERS',
  'MAX_BRANCHES',
  'MAX_ISSUE_POINTS_PER_BRANCH',
] as const;

export type PlanOverview = {
  plan: { key: string; nameEs: string; nameEn: string; selfService: boolean };
  billing: (typeof SUBSCRIPTION_BILLING)[number];
  modules: PlanModule[];
  // As resolved for this request, overrides included; null is unlimited.
  limits: Record<(typeof SHOWN_LIMITS)[number], number | null>;
};

// The plan page (FR-PLAN-4). The twin reads its own mirrored rows.
export async function planOverview(ctx: ActorContext, db: Database): Promise<PlanOverview> {
  requirePermission(ctx, 'billing.read');
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const { subscriptions, subscriptionItems, plans, planModules, modules } = schema;
    const [row] = await tx
      .select({
        id: subscriptions.id,
        billing: subscriptions.billing,
        planId: plans.id,
        key: plans.key,
        nameEs: plans.nameEs,
        nameEn: plans.nameEn,
        selfService: plans.selfService,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId));
    if (!row) throw new Error(`Tenant ${ctx.tenantId} has no subscription`);

    const columns = {
      key: modules.key,
      nameEs: modules.nameEs,
      nameEn: modules.nameEn,
      status: modules.status,
      sortOrder: modules.sortOrder,
    };
    const fromPlan = await tx
      .select({ ...columns, removesAt: planModules.removesAt })
      .from(planModules)
      .innerJoin(modules, eq(modules.id, planModules.moduleId))
      .where(eq(planModules.planId, row.planId));
    const addOns = await tx
      .select({ ...columns, removesAt: subscriptionItems.removesAt })
      .from(subscriptionItems)
      .innerJoin(modules, eq(modules.id, subscriptionItems.moduleId))
      .where(
        and(
          eq(subscriptionItems.subscriptionId, row.id),
          eq(subscriptionItems.kind, 'MODULE'),
          eq(subscriptionItems.active, true),
        ),
      );
    // A removal whose period has started is gone; the resolver agrees.
    const periodStart = currentPeriodStart(ctx.clock.now());
    const current = <T extends { removesAt: Date | null }>(rows: T[]) =>
      rows.filter((row) => row.removesAt === null || row.removesAt > periodStart);
    const inPlan = new Set(current(fromPlan).map((module) => module.key));
    const listed = [
      ...current(fromPlan).map((module) => ({ ...module, source: 'PLAN' as const })),
      ...current(addOns)
        .filter((module) => !inPlan.has(module.key))
        .map((module) => ({ ...module, source: 'ADD_ON' as const })),
    ].sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      plan: { key: row.key, nameEs: row.nameEs, nameEn: row.nameEn, selfService: row.selfService },
      billing: row.billing,
      modules: listed.map((module) => ({
        key: module.key,
        nameEs: module.nameEs,
        nameEn: module.nameEn,
        status: module.status,
        source: module.source,
        removesAt: module.removesAt,
      })),
      limits: Object.fromEntries(
        SHOWN_LIMITS.map((key) => [key, limitOf(ctx.entitlements, key)]),
      ) as PlanOverview['limits'],
    };
  });
}
