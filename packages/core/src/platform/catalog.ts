import type { Database, NotificationType, Tx } from '@comprobify/db';
import { recordPlatformAudit, type PlatformAuditAction } from '../audit';
import {
  applyAddModuleFeature,
  applyAddPlanModule,
  applyCreateModule,
  applyCreatePlan,
  applyPlanLimit,
  applyRemoveModuleFeature,
  applyRemovePlanModule,
  applyUpdateModule,
  applyUpdatePlan,
  catalogView,
  companiesOnPlan,
  companiesWithModule,
  LIMIT_NAMES,
  type CatalogView,
  type FeatureKey,
} from '../entitlements';
import { assertSuperAdmin } from '../identity';
import { ecuadorDate, type PlatformActor } from '../kernel';
import { notify, type NotificationParams, type NotifyDeps } from '../notifications';

// FR-ADM-3: the plan and module editors. Each change is one system-context transaction,
// recorded in the platform's own log; the rules on notice live in entitlements.

export async function getCatalog(actor: PlatformActor, db: Database): Promise<CatalogView> {
  await assertSuperAdmin(db.identity, actor);
  return db.withSystem('super admin: view the plan catalog', ({ db: tx }) => catalogView(tx));
}

type Details = Record<string, string | number | boolean | null>;

async function edit(
  actor: PlatformActor,
  db: Database,
  reason: string,
  action: PlatformAuditAction,
  fn: (tx: Tx['db'], now: Date, full: Tx) => Promise<Details>,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  await db.withSystem(reason, async (full) => {
    const tx = full.db;
    const details = await fn(tx, actor.clock.now(), full);
    await recordPlatformAudit(tx, { actorUserId: actor.userId, action, details });
  });
}

// FR-NOT-2, ADR-011: a change dated ahead is told to the companies it reaches, in the same
// transaction. Nothing is told for one that applies now (a draft plan, a coming-soon module).
async function tellCompanies(
  full: Tx,
  notice: NotifyDeps,
  now: Date,
  change: { companies: string[]; type: NotificationType; on: Date; params: NotificationParams },
) {
  if (change.on.getTime() <= now.getTime()) return;
  const params = { ...change.params, date: ecuadorDate(change.on) };
  for (const tenantId of change.companies)
    await notify(full, notice, { tenantId, type: change.type, params });
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export const createModule = (
  actor: PlatformActor,
  db: Database,
  input: { key: string; nameEs: string; nameEn: string },
) =>
  edit(actor, db, 'super admin: create a module', 'module.created', async (tx) => {
    await applyCreateModule(tx, input);
    return { module: input.key };
  });

export const updateModule = (
  actor: PlatformActor,
  db: Database,
  input: { key: string; nameEs: string; nameEn: string; status: string },
) =>
  edit(actor, db, 'super admin: update a module', 'module.updated', async (tx) => {
    const { status } = await applyUpdateModule(tx, input);
    return { module: input.key, status };
  });

export const addModuleFeature = (
  actor: PlatformActor,
  db: Database,
  input: { moduleKey: string; featureKey: string },
) =>
  edit(actor, db, 'super admin: add a feature to a module', 'module.feature_added', async (tx) => {
    await applyAddModuleFeature(tx, input);
    return { module: input.moduleKey, feature: input.featureKey };
  });

export const removeModuleFeature = (
  actor: PlatformActor,
  db: Database,
  input: { moduleKey: string; featureKey: string },
  notice: NotifyDeps,
) =>
  edit(
    actor,
    db,
    'super admin: remove a feature from a module',
    'module.feature_removed',
    async (tx, now, full) => {
      const { removesAt, module } = await applyRemoveModuleFeature(tx, input, now);
      await tellCompanies(full, notice, now, {
        companies: await companiesWithModule(tx, module.id),
        type: 'PLAN_CONTENT_LEAVING',
        on: removesAt,
        params: { name: module.nameEs, nameEn: module.nameEn },
      });
      return { module: input.moduleKey, feature: input.featureKey, removesAt: iso(removesAt) };
    },
  );

export const createPlan = (
  actor: PlatformActor,
  db: Database,
  input: { key: string; nameEs: string; nameEn: string; selfService: boolean },
) =>
  edit(actor, db, 'super admin: create a plan', 'plan.created', async (tx) => {
    await applyCreatePlan(tx, input);
    return { plan: input.key };
  });

export const updatePlan = (
  actor: PlatformActor,
  db: Database,
  input: { key: string; nameEs: string; nameEn: string; selfService: boolean; status: string },
) =>
  edit(actor, db, 'super admin: update a plan', 'plan.updated', async (tx) => {
    const { status } = await applyUpdatePlan(tx, input);
    return { plan: input.key, status, selfService: input.selfService };
  });

export const addPlanModule = (
  actor: PlatformActor,
  db: Database,
  input: { planKey: string; moduleKey: string },
) =>
  edit(actor, db, 'super admin: add a module to a plan', 'plan.module_added', async (tx) => {
    await applyAddPlanModule(tx, input);
    return { plan: input.planKey, module: input.moduleKey };
  });

export const removePlanModule = (
  actor: PlatformActor,
  db: Database,
  input: { planKey: string; moduleKey: string },
  notice: NotifyDeps,
) =>
  edit(
    actor,
    db,
    'super admin: remove a module from a plan',
    'plan.module_removed',
    async (tx, now, full) => {
      const { removesAt, plan, module } = await applyRemovePlanModule(tx, input, now);
      await tellCompanies(full, notice, now, {
        companies: await companiesOnPlan(tx, plan.id),
        type: 'PLAN_CONTENT_LEAVING',
        on: removesAt,
        params: { name: module.nameEs, nameEn: module.nameEn },
      });
      return { plan: input.planKey, module: input.moduleKey, removesAt: iso(removesAt) };
    },
  );

export const setPlanLimit = (
  actor: PlatformActor,
  db: Database,
  input: { planKey: string; featureKey: string; value: number | null },
  notice: NotifyDeps,
) =>
  edit(
    actor,
    db,
    'super admin: change a plan limit',
    'plan.limit_changed',
    async (tx, now, full) => {
      const { value, from, planId } = await applyPlanLimit(tx, input, now);
      const label = LIMIT_NAMES[input.featureKey as FeatureKey];
      // A lowered limit is dated; a raised one is immediate and needs no notice.
      if (from && value !== null)
        await tellCompanies(full, notice, now, {
          companies: await companiesOnPlan(tx, planId),
          type: 'PLAN_LIMIT_LOWERING',
          on: from,
          params: {
            name: label?.es ?? input.featureKey,
            nameEn: label?.en ?? input.featureKey,
            count: String(value),
          },
        });
      return { plan: input.planKey, feature: input.featureKey, value, from: iso(from) };
    },
  );
