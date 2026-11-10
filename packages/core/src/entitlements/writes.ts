import { and, eq, inArray, isNull, schema, sql, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { DomainError } from '../kernel';
import { FEATURE_KEYS, FEATURES, type FeatureKey } from './features';
import type { CompanyTenants } from './subscriptions';

// The super admin's changes (ADR-011). Each runs in the caller's system-context
// transaction and writes the company and its twin alike (FR-ONB-6a).

export const CUSTOM_PLAN_KEY = 'CUSTOM';

const LIMIT_KEYS = FEATURE_KEYS.filter((key) => FEATURES[key] === 'LIMIT') as [
  FeatureKey,
  ...FeatureKey[],
];
const limitValue = z.number().int().min(0).max(1_000_000_000).nullable();
const reason = z.string().trim().min(3).max(300);

export const changePlanInput = z.object({ planKey: z.string().min(1).max(60) });
export const billingInput = z.discriminatedUnion('complimentary', [
  z.object({ complimentary: z.literal(true), reason }),
  z.object({ complimentary: z.literal(false) }),
]);
// A decimal string, never a float (CLAUDE.md rule 14).
export const priceInput = z.object({
  monthlyPrice: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/)
    .nullable(),
});
export const moduleInput = z.object({ moduleKey: z.string().min(1).max(60) });
export const limitInput = z.object({ featureKey: z.enum(LIMIT_KEYS), value: limitValue });
export const clearLimitInput = z.object({ featureKey: z.enum(LIMIT_KEYS) });
export const overrideInput = z.object({
  featureKey: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]),
  effect: z.enum(['GRANT', 'REVOKE', 'LIMIT']),
  limitValue,
  reason,
});
export const clearOverrideInput = z.object({
  featureKey: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]),
});

const tenantsOf = (company: CompanyTenants) => [company.realTenantId, company.twinTenantId];

type Subscription = { id: string; tenantId: string; planId: string; planKey: string };

// The real company's subscription; the twin's mirrors it.
async function subscriptionsOf(
  tx: Tx['db'],
  company: CompanyTenants,
): Promise<{ real: Subscription; all: Subscription[] }> {
  const { subscriptions, plans } = schema;
  const rows = await tx
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      planId: subscriptions.planId,
      planKey: plans.key,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(subscriptions.tenantId, tenantsOf(company)));
  const real = rows.find((row) => row.tenantId === company.realTenantId);
  if (!real || rows.length !== 2) throw new Error('Company or twin has no subscription');
  return { real, all: rows };
}

async function requireCustom(tx: Tx['db'], company: CompanyTenants): Promise<void> {
  const { real } = await subscriptionsOf(tx, company);
  if (real.planKey !== CUSTOM_PLAN_KEY)
    throw new DomainError('NOT_CUSTOM_PLAN', 'Only Personalizado takes its own limits and price');
}

export type Named = { nameEs: string; nameEn: string };
export type PlanChange = Named & { from: string; to: string };

// Immediate: the operator's choice. Leaving Personalizado drops its limits and price;
// add-on modules stay, as any plan can carry them.
export async function applyPlanChange(
  tx: Tx['db'],
  company: CompanyTenants,
  raw: z.input<typeof changePlanInput>,
): Promise<PlanChange> {
  const input = changePlanInput.parse(raw);
  const { plans, subscriptions, subscriptionItems } = schema;
  const [plan] = await tx.select().from(plans).where(eq(plans.key, input.planKey));
  if (!plan || plan.status !== 'PUBLISHED')
    throw new DomainError('PLAN_NOT_AVAILABLE', 'That plan is not published');
  const { real } = await subscriptionsOf(tx, company);
  if (real.planKey === plan.key) throw new DomainError('SAME_PLAN', 'The company is on that plan');
  const leavingCustom = real.planKey === CUSTOM_PLAN_KEY;
  for (const tenantId of tenantsOf(company)) {
    await tx
      .update(subscriptions)
      .set({
        planId: plan.id,
        updatedAt: sql`now()`,
        ...(leavingCustom ? { negotiatedMonthlyPrice: null } : {}),
      })
      .where(eq(subscriptions.tenantId, tenantId));
    if (leavingCustom)
      await tx
        .update(subscriptionItems)
        .set({ active: false, updatedAt: sql`now()` })
        .where(
          and(
            eq(subscriptionItems.tenantId, tenantId),
            eq(subscriptionItems.kind, 'LIMIT'),
            eq(subscriptionItems.active, true),
          ),
        );
  }
  return { from: real.planKey, to: plan.key, nameEs: plan.nameEs, nameEn: plan.nameEn };
}

export async function applyBilling(
  tx: Tx['db'],
  company: CompanyTenants,
  raw: z.input<typeof billingInput>,
): Promise<void> {
  const input = billingInput.parse(raw);
  for (const tenantId of tenantsOf(company))
    await tx
      .update(schema.subscriptions)
      .set({
        billing: input.complimentary ? 'COMPLIMENTARY' : 'PAID',
        complimentaryReason: input.complimentary ? input.reason : null,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.subscriptions.tenantId, tenantId));
}

// Stored now; billing (Milestone 8) charges it from the next renewal.
export async function applyNegotiatedPrice(
  tx: Tx['db'],
  company: CompanyTenants,
  raw: z.input<typeof priceInput>,
): Promise<void> {
  const input = priceInput.parse(raw);
  await requireCustom(tx, company);
  for (const tenantId of tenantsOf(company))
    await tx
      .update(schema.subscriptions)
      .set({ negotiatedMonthlyPrice: input.monthlyPrice, updatedAt: sql`now()` })
      .where(eq(schema.subscriptions.tenantId, tenantId));
}

async function moduleByKey(tx: Tx['db'], key: string) {
  const [row] = await tx.select().from(schema.modules).where(eq(schema.modules.key, key));
  if (!row) throw new DomainError('MODULE_NOT_FOUND', 'No such module');
  return row;
}

// Immediate. Re-adding a module whose removal is scheduled cancels the removal.
export async function applyAddModule(
  tx: Tx['db'],
  company: CompanyTenants,
  raw: z.input<typeof moduleInput>,
): Promise<Named> {
  const input = moduleInput.parse(raw);
  const module = await moduleByKey(tx, input.moduleKey);
  // A coming-soon module can't be bought on its own (ADR-011).
  if (module.status !== 'AVAILABLE' || module.isBase)
    throw new DomainError('MODULE_NOT_AVAILABLE', 'That module can not be added');
  const { real, all } = await subscriptionsOf(tx, company);
  const { planModules, subscriptionItems } = schema;
  const [inPlan] = await tx
    .select({ moduleId: planModules.moduleId })
    .from(planModules)
    .where(
      and(
        eq(planModules.planId, real.planId),
        eq(planModules.moduleId, module.id),
        isNull(planModules.removesAt),
      ),
    );
  if (inPlan) throw new DomainError('MODULE_IN_PLAN', 'The plan already includes that module');
  for (const subscription of all) {
    const [item] = await tx
      .select({ id: subscriptionItems.id, removesAt: subscriptionItems.removesAt })
      .from(subscriptionItems)
      .where(
        and(
          eq(subscriptionItems.subscriptionId, subscription.id),
          eq(subscriptionItems.moduleId, module.id),
          eq(subscriptionItems.active, true),
        ),
      );
    if (item && !item.removesAt)
      throw new DomainError('MODULE_ALREADY_ADDED', 'The company already has that module');
    if (item)
      await tx
        .update(subscriptionItems)
        .set({ removesAt: null, updatedAt: sql`now()` })
        .where(eq(subscriptionItems.id, item.id));
    else
      await tx.insert(subscriptionItems).values({
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        kind: 'MODULE',
        moduleId: module.id,
      });
  }
  return { nameEs: module.nameEs, nameEn: module.nameEn };
}

// Dated: the company keeps the module until the next period starts (ADR-011).
export async function applyRemoveModule(
  tx: Tx['db'],
  company: CompanyTenants,
  raw: z.input<typeof moduleInput>,
  removesAt: Date,
): Promise<Named> {
  const input = moduleInput.parse(raw);
  const module = await moduleByKey(tx, input.moduleKey);
  const { subscriptionItems } = schema;
  const updated = await tx
    .update(subscriptionItems)
    .set({ removesAt, updatedAt: sql`now()` })
    .where(
      and(
        inArray(subscriptionItems.tenantId, tenantsOf(company)),
        eq(subscriptionItems.moduleId, module.id),
        eq(subscriptionItems.active, true),
        isNull(subscriptionItems.removesAt),
      ),
    )
    .returning({ id: subscriptionItems.id });
  if (updated.length === 0)
    throw new DomainError('MODULE_NOT_ADDED', 'The company has not added that module');
  return { nameEs: module.nameEs, nameEn: module.nameEn };
}

// Personalizado's own value for a limit, replacing the plan's; null is unlimited.
export async function applyLimit(
  tx: Tx['db'],
  company: CompanyTenants,
  // Form input arrives as strings; the schema narrows it.
  raw: unknown,
): Promise<void> {
  const input = limitInput.parse(raw);
  await requireCustom(tx, company);
  const { all } = await subscriptionsOf(tx, company);
  const { subscriptionItems } = schema;
  for (const subscription of all) {
    await deactivateLimit(tx, subscription.id, input.featureKey);
    await tx.insert(subscriptionItems).values({
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      kind: 'LIMIT',
      featureKey: input.featureKey,
      limitValue: input.value,
    });
  }
}

async function deactivateLimit(tx: Tx['db'], subscriptionId: string, featureKey: string) {
  const { subscriptionItems } = schema;
  return tx
    .update(subscriptionItems)
    .set({ active: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(subscriptionItems.subscriptionId, subscriptionId),
        eq(subscriptionItems.kind, 'LIMIT'),
        eq(subscriptionItems.featureKey, featureKey),
        eq(subscriptionItems.active, true),
      ),
    )
    .returning({ id: subscriptionItems.id });
}

// Back to the plan's value.
export async function applyClearLimit(
  tx: Tx['db'],
  company: CompanyTenants,
  raw: unknown,
): Promise<void> {
  const input = clearLimitInput.parse(raw);
  const { all } = await subscriptionsOf(tx, company);
  let cleared = 0;
  for (const subscription of all)
    cleared += (await deactivateLimit(tx, subscription.id, input.featureKey)).length;
  if (cleared === 0) throw new DomainError('LIMIT_NOT_SET', 'That limit uses the plan value');
}

// One active override per key: a new one replaces it.
export async function applyOverride(
  tx: Tx['db'],
  company: CompanyTenants,
  raw: unknown,
  createdBy: string,
): Promise<void> {
  const input = overrideInput.parse(raw);
  const kind = FEATURES[input.featureKey];
  if (
    (input.effect === 'LIMIT') !== (kind === 'LIMIT') ||
    (kind === 'BOOLEAN' && input.limitValue !== null)
  )
    throw new DomainError('INVALID_OVERRIDE', 'A boolean is granted or revoked; a limit is set');
  await clearOverrides(tx, company, input.featureKey);
  for (const tenantId of tenantsOf(company))
    await tx.insert(schema.tenantFeatureOverrides).values({
      tenantId,
      featureKey: input.featureKey,
      featureKind: kind,
      effect: input.effect,
      limitValue: input.effect === 'LIMIT' ? input.limitValue : null,
      reason: input.reason,
      createdBy,
    });
}

async function clearOverrides(tx: Tx['db'], company: CompanyTenants, featureKey: string) {
  const { tenantFeatureOverrides } = schema;
  return tx
    .update(tenantFeatureOverrides)
    .set({ active: false, updatedAt: sql`now()` })
    .where(
      and(
        inArray(tenantFeatureOverrides.tenantId, tenantsOf(company)),
        eq(tenantFeatureOverrides.featureKey, featureKey),
        eq(tenantFeatureOverrides.active, true),
      ),
    )
    .returning({ id: tenantFeatureOverrides.id });
}

export async function applyClearOverride(
  tx: Tx['db'],
  company: CompanyTenants,
  raw: unknown,
): Promise<void> {
  const input = clearOverrideInput.parse(raw);
  if ((await clearOverrides(tx, company, input.featureKey)).length === 0)
    throw new DomainError('OVERRIDE_NOT_FOUND', 'No override for that feature');
}

// FR-BILL-1 (ADR-029): what a verified payment, a renewal or a refund sets on the subscription,
// for the company and its twin alike. Returns how it was before, which a refund restores.
export type SubscriptionTerm = {
  planId: string;
  interval: 'MONTHLY' | 'YEARLY';
  status: 'ACTIVE' | 'CANCELLED' | 'PAST_DUE';
  periodStart: string;
  periodEnd: string | null;
  extraSeats: number;
  pendingPlanId: string | null;
  pendingInterval: 'MONTHLY' | 'YEARLY' | null;
  pendingSeats: number | null;
};

export async function applySubscriptionTerm(
  tx: Tx['db'],
  company: CompanyTenants,
  term: SubscriptionTerm,
): Promise<SubscriptionTerm> {
  const { subscriptions } = schema;
  const [before] = await tx
    .select({
      planId: subscriptions.planId,
      interval: subscriptions.interval,
      status: subscriptions.status,
      periodStart: subscriptions.periodStart,
      periodEnd: subscriptions.periodEnd,
      extraSeats: subscriptions.extraSeats,
      pendingPlanId: subscriptions.pendingPlanId,
      pendingInterval: subscriptions.pendingInterval,
      pendingSeats: subscriptions.pendingSeats,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, company.realTenantId))
    .for('update');
  if (!before) throw new Error('The company has no subscription');
  for (const tenantId of tenantsOf(company))
    await tx
      .update(subscriptions)
      .set({ ...term, updatedAt: sql`now()` })
      .where(eq(subscriptions.tenantId, tenantId));
  return before;
}

// A bought add-on whose payment was refunded: gone at once, from the company and its twin.
export async function applyDropAddOn(
  tx: Tx['db'],
  company: CompanyTenants,
  moduleId: string,
): Promise<void> {
  const { subscriptionItems } = schema;
  await tx
    .update(subscriptionItems)
    .set({ active: false, updatedAt: sql`now()` })
    .where(
      and(
        inArray(subscriptionItems.tenantId, tenantsOf(company)),
        eq(subscriptionItems.moduleId, moduleId),
        eq(subscriptionItems.kind, 'MODULE'),
        eq(subscriptionItems.active, true),
      ),
    );
}
