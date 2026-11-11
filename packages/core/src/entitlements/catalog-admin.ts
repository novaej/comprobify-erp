import { and, asc, eq, isNull, schema, sql, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { DomainError } from '../kernel';
import type { ModuleStatus, PlanStatus } from './catalog';
import { FEATURES, FEATURE_KEYS, type FeatureKey } from './features';
import { DEFAULT_PLAN_KEY } from './subscriptions';

// The super admin's editors for modules and plans (ADR-011, FR-ADM-3), in the caller's
// system-context transaction. Anything that takes something away from companies is
// dated NOTICE_DAYS ahead, like a price change (FR-BILL-6); everything else is immediate.

export const NOTICE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const noticeFrom = (now: Date) => new Date(now.getTime() + NOTICE_DAYS * DAY_MS);

const key = z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/);
const name = z.string().trim().min(1).max(80);
const featureKey = z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]);
const limitValue = z.number().int().min(0).max(1_000_000_000).nullable();

export const createModuleInput = z.object({ key, nameEs: name, nameEn: name });
export const updateModuleInput = z.object({
  key,
  nameEs: name,
  nameEn: name,
  status: z.enum(['AVAILABLE', 'COMING_SOON']),
});
export const moduleFeatureInput = z.object({ moduleKey: key, featureKey });
export const createPlanInput = z.object({
  key,
  nameEs: name,
  nameEn: name,
  selfService: z.boolean(),
});
export const updatePlanInput = createPlanInput.extend({
  status: z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']),
});
export const planModuleInput = z.object({ planKey: key, moduleKey: key });
export const planLimitInput = z.object({ planKey: key, featureKey, value: limitValue });

export type CatalogView = {
  modules: {
    key: string;
    nameEs: string;
    nameEn: string;
    status: ModuleStatus;
    isBase: boolean;
    features: { key: string; removesAt: Date | null }[];
  }[];
  plans: {
    key: string;
    nameEs: string;
    nameEn: string;
    status: PlanStatus;
    selfService: boolean;
    modules: { key: string; removesAt: Date | null }[];
    limits: {
      key: string;
      value: number | null;
      pendingValue: number | null;
      pendingFrom: Date | null;
    }[];
  }[];
};

// The whole catalog: small platform data, read in one go.
export async function catalogView(tx: Tx['db']): Promise<CatalogView> {
  const { modules, moduleFeatures, plans, planModules, planLimits } = schema;
  const moduleRows = await tx.select().from(modules).orderBy(asc(modules.sortOrder));
  const featureRows = await tx.select().from(moduleFeatures);
  const planRows = await tx.select().from(plans).orderBy(asc(plans.sortOrder));
  const linkRows = await tx
    .select({ planId: planModules.planId, key: modules.key, removesAt: planModules.removesAt })
    .from(planModules)
    .innerJoin(modules, eq(modules.id, planModules.moduleId))
    .orderBy(asc(modules.sortOrder));
  const limitRows = await tx.select().from(planLimits);
  return {
    modules: moduleRows.map((module) => ({
      key: module.key,
      nameEs: module.nameEs,
      nameEn: module.nameEn,
      status: module.status,
      isBase: module.isBase,
      features: featureRows
        .filter((row) => row.moduleId === module.id)
        .map((row) => ({ key: row.featureKey, removesAt: row.removesAt }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    })),
    plans: planRows.map((plan) => ({
      key: plan.key,
      nameEs: plan.nameEs,
      nameEn: plan.nameEn,
      status: plan.status,
      selfService: plan.selfService,
      modules: linkRows
        .filter((row) => row.planId === plan.id)
        .map((row) => ({ key: row.key, removesAt: row.removesAt })),
      limits: limitRows
        .filter((row) => row.planId === plan.id)
        .map((row) => ({
          key: row.featureKey,
          value: row.value,
          pendingValue: row.pendingValue,
          pendingFrom: row.pendingFrom,
        })),
    })),
  };
}

async function moduleByKey(tx: Tx['db'], moduleKey: string) {
  const [row] = await tx.select().from(schema.modules).where(eq(schema.modules.key, moduleKey));
  if (!row) throw new DomainError('MODULE_NOT_FOUND', 'No such module');
  return row;
}

async function planByKey(tx: Tx['db'], planKey: string) {
  const [row] = await tx.select().from(schema.plans).where(eq(schema.plans.key, planKey));
  if (!row) throw new DomainError('PLAN_NOT_FOUND', 'No such plan');
  return row;
}

const isUniqueViolation = (error: unknown) => {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return (
    typeof pgError === 'object' && pgError !== null && 'code' in pgError && pgError.code === '23505'
  );
};

// New modules start coming soon: they grant nothing until the code behind them ships.
export async function applyCreateModule(tx: Tx['db'], raw: unknown): Promise<void> {
  const input = createModuleInput.parse(raw);
  const [last] = await tx
    .select({ sortOrder: sql<number>`coalesce(max(${schema.modules.sortOrder}), -1)` })
    .from(schema.modules);
  try {
    await tx.insert(schema.modules).values({
      key: input.key,
      nameEs: input.nameEs,
      nameEn: input.nameEn,
      status: 'COMING_SOON',
      sortOrder: (last?.sortOrder ?? -1) + 1,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('KEY_TAKEN', 'That key is in use');
    throw error;
  }
}

// Status only moves forward: making a module coming soon again would take it from
// every company at once, with no notice.
export const MODULE_STATUS_MOVES: Record<ModuleStatus, ModuleStatus[]> = {
  COMING_SOON: ['COMING_SOON', 'AVAILABLE'],
  AVAILABLE: ['AVAILABLE'],
};

export async function applyUpdateModule(tx: Tx['db'], raw: unknown): Promise<{ status: string }> {
  const input = updateModuleInput.parse(raw);
  const module = await moduleByKey(tx, input.key);
  if (!MODULE_STATUS_MOVES[module.status].includes(input.status))
    throw new DomainError('STATUS_BACKWARD', 'An available module can not go back to coming soon');
  await tx
    .update(schema.modules)
    .set({
      nameEs: input.nameEs,
      nameEn: input.nameEn,
      status: input.status,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.modules.id, module.id));
  return { status: input.status };
}

export async function applyAddModuleFeature(tx: Tx['db'], raw: unknown): Promise<void> {
  const input = moduleFeatureInput.parse(raw);
  if (FEATURES[input.featureKey] !== 'BOOLEAN')
    throw new DomainError('NOT_A_FEATURE', 'Only on/off features go in a module');
  const module = await moduleByKey(tx, input.moduleKey);
  const { moduleFeatures } = schema;
  const where = and(
    eq(moduleFeatures.moduleId, module.id),
    eq(moduleFeatures.featureKey, input.featureKey),
  );
  const [row] = await tx.select().from(moduleFeatures).where(where);
  if (row && !row.removesAt)
    throw new DomainError('ALREADY_IN_MODULE', 'The module already has that feature');
  // Back before its removal date: the removal is cancelled.
  if (row)
    await tx
      .update(moduleFeatures)
      .set({ removesAt: null, addedAt: sql`now()` })
      .where(where);
  else
    await tx.insert(moduleFeatures).values({ moduleId: module.id, featureKey: input.featureKey });
}

// Dated, unless the module is coming soon and grants nothing yet. Rows are never deleted.
export async function applyRemoveModuleFeature(
  tx: Tx['db'],
  raw: unknown,
  now: Date,
): Promise<{ removesAt: Date; module: typeof schema.modules.$inferSelect }> {
  const input = moduleFeatureInput.parse(raw);
  const module = await moduleByKey(tx, input.moduleKey);
  const removesAt = module.status === 'COMING_SOON' ? now : noticeFrom(now);
  const { moduleFeatures } = schema;
  const updated = await tx
    .update(moduleFeatures)
    .set({ removesAt })
    .where(
      and(
        eq(moduleFeatures.moduleId, module.id),
        eq(moduleFeatures.featureKey, input.featureKey),
        isNull(moduleFeatures.removesAt),
      ),
    )
    .returning({ key: moduleFeatures.featureKey });
  if (updated.length === 0)
    throw new DomainError('NOT_IN_MODULE', 'The module does not have that feature');
  return { removesAt, module };
}

// A draft, with the base module and the default plan's limits to start from.
export async function applyCreatePlan(tx: Tx['db'], raw: unknown): Promise<void> {
  const input = createPlanInput.parse(raw);
  const { plans, planModules, planLimits, modules } = schema;
  const [last] = await tx
    .select({ sortOrder: sql<number>`coalesce(max(${plans.sortOrder}), -1)` })
    .from(plans);
  const [plan] = await tx
    .insert(plans)
    .values({
      key: input.key,
      nameEs: input.nameEs,
      nameEn: input.nameEn,
      status: 'DRAFT',
      selfService: input.selfService,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    })
    .onConflictDoNothing({ target: plans.key })
    .returning({ id: plans.id });
  if (!plan) throw new DomainError('KEY_TAKEN', 'That key is in use');
  const [base] = await tx.select({ id: modules.id }).from(modules).where(eq(modules.isBase, true));
  await tx.insert(planModules).values({ planId: plan.id, moduleId: base!.id });
  const defaults = await tx
    .select({ featureKey: planLimits.featureKey, value: planLimits.value })
    .from(planLimits)
    .innerJoin(plans, eq(plans.id, planLimits.planId))
    .where(eq(plans.key, DEFAULT_PLAN_KEY));
  if (defaults.length > 0)
    await tx.insert(planLimits).values(defaults.map((row) => ({ planId: plan.id, ...row })));
}

export const PLAN_STATUS_MOVES: Record<PlanStatus, PlanStatus[]> = {
  DRAFT: ['DRAFT', 'PUBLISHED', 'RETIRED'],
  PUBLISHED: ['PUBLISHED', 'RETIRED'],
  // Retired plans keep their companies; publishing again offers it to new ones.
  RETIRED: ['RETIRED', 'PUBLISHED'],
};

export async function applyUpdatePlan(tx: Tx['db'], raw: unknown): Promise<{ status: string }> {
  const input = updatePlanInput.parse(raw);
  const plan = await planByKey(tx, input.key);
  if (!PLAN_STATUS_MOVES[plan.status].includes(input.status))
    throw new DomainError('STATUS_BACKWARD', 'A plan in use can not go back to draft');
  await tx
    .update(schema.plans)
    .set({
      nameEs: input.nameEs,
      nameEn: input.nameEn,
      status: input.status,
      selfService: input.selfService,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.plans.id, plan.id));
  return { status: input.status };
}

export async function applyAddPlanModule(tx: Tx['db'], raw: unknown): Promise<void> {
  const input = planModuleInput.parse(raw);
  const plan = await planByKey(tx, input.planKey);
  const module = await moduleByKey(tx, input.moduleKey);
  const { planModules } = schema;
  const where = and(eq(planModules.planId, plan.id), eq(planModules.moduleId, module.id));
  const [row] = await tx.select().from(planModules).where(where);
  if (row && !row.removesAt)
    throw new DomainError('MODULE_IN_PLAN', 'The plan already includes that module');
  if (row)
    await tx
      .update(planModules)
      .set({ removesAt: null, addedAt: sql`now()` })
      .where(where);
  else await tx.insert(planModules).values({ planId: plan.id, moduleId: module.id });
}

// Dated, unless the plan is still a draft with no companies on it.
export async function applyRemovePlanModule(
  tx: Tx['db'],
  raw: unknown,
  now: Date,
): Promise<{
  removesAt: Date;
  plan: typeof schema.plans.$inferSelect;
  module: typeof schema.modules.$inferSelect;
}> {
  const input = planModuleInput.parse(raw);
  const plan = await planByKey(tx, input.planKey);
  const module = await moduleByKey(tx, input.moduleKey);
  if (module.isBase)
    throw new DomainError('BASE_MODULE_REQUIRED', 'Every plan keeps the base module');
  const removesAt = plan.status === 'DRAFT' ? now : noticeFrom(now);
  const { planModules } = schema;
  const updated = await tx
    .update(planModules)
    .set({ removesAt })
    .where(
      and(
        eq(planModules.planId, plan.id),
        eq(planModules.moduleId, module.id),
        isNull(planModules.removesAt),
      ),
    )
    .returning({ moduleId: planModules.moduleId });
  if (updated.length === 0)
    throw new DomainError('MODULE_NOT_IN_PLAN', 'The plan does not include that module');
  return { removesAt, plan, module };
}

// null is unlimited, so it is above every number.
const atLeast = (a: number | null, b: number | null) => a === null || (b !== null && a >= b);

export type LimitChange = { value: number | null; from: Date | null; planId: string };

// Raising a limit is immediate; lowering one on a plan in use is dated, so no company
// finds itself over its limit overnight. `from` is null when it applies now.
export async function applyPlanLimit(tx: Tx['db'], raw: unknown, now: Date): Promise<LimitChange> {
  const input = planLimitInput.parse(raw);
  if (FEATURES[input.featureKey] !== 'LIMIT')
    throw new DomainError('NOT_A_LIMIT', 'Only limits take a value');
  const plan = await planByKey(tx, input.planKey);
  const { planLimits } = schema;
  const where = and(eq(planLimits.planId, plan.id), eq(planLimits.featureKey, input.featureKey));
  const [row] = await tx.select().from(planLimits).where(where);
  // A lowered value whose date has passed is the value now.
  const current =
    row?.pendingFrom && row.pendingFrom <= now ? row.pendingValue : row ? row.value : 0;
  const immediate = plan.status === 'DRAFT' || atLeast(input.value, current ?? null);
  const change = immediate
    ? { value: input.value, pendingValue: null, pendingFrom: null }
    : { value: current ?? null, pendingValue: input.value, pendingFrom: noticeFrom(now) };
  if (row) await tx.update(planLimits).set(change).where(where);
  else
    await tx
      .insert(planLimits)
      .values({ planId: plan.id, featureKey: input.featureKey, ...change });
  return { value: input.value, from: immediate ? null : change.pendingFrom, planId: plan.id };
}

// Who a change to the catalog reaches (system context): the real, active companies on a plan,
// and those that hold a module through their plan or as an add-on. A test copy tells no one.
const realCompany = and(eq(schema.tenants.mode, 'PRODUCTION'), eq(schema.tenants.status, 'ACTIVE'));

export async function companiesOnPlan(tx: Tx['db'], planId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.tenants.id })
    .from(schema.subscriptions)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.subscriptions.tenantId))
    .where(and(eq(schema.subscriptions.planId, planId), realCompany));
  return rows.map((row) => row.id);
}

export async function companiesWithModule(tx: Tx['db'], moduleId: string): Promise<string[]> {
  const { subscriptions, subscriptionItems, planModules, tenants } = schema;
  const throughPlan = await tx
    .select({ id: tenants.id })
    .from(planModules)
    .innerJoin(subscriptions, eq(subscriptions.planId, planModules.planId))
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(and(eq(planModules.moduleId, moduleId), isNull(planModules.removesAt), realCompany));
  const addOns = await tx
    .select({ id: tenants.id })
    .from(subscriptionItems)
    .innerJoin(tenants, eq(tenants.id, subscriptionItems.tenantId))
    .where(
      and(
        eq(subscriptionItems.kind, 'MODULE'),
        eq(subscriptionItems.active, true),
        eq(subscriptionItems.moduleId, moduleId),
        realCompany,
      ),
    );
  return [...new Set([...throughPlan, ...addOns].map((row) => row.id))];
}
