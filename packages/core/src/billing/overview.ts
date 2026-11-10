import { and, asc, eq, isNull, schema, type Database } from '@comprobify/db';
import { ecuadorDate, requirePermission, type ActorContext } from '../kernel';
import { inCompany, listPaymentsIn, type PaymentView } from './payments';
import { packBalance } from './packs';
import { priceOn, YEARLY_MONTHS } from './prices';

// FR-BILL-1, FR-BILL-5, FR-BILL-7: what the company's billing page shows and offers, at today's
// prices before IVA. Core still decides every change; this only lists what may be asked for.

type Named = { key: string; nameEs: string; nameEn: string };

export type BillingOverview = {
  subscription: {
    billing: 'PAID' | 'COMPLIMENTARY';
    planKey: string;
    interval: 'MONTHLY' | 'YEARLY';
    status: 'ACTIVE' | 'CANCELLED' | 'PAST_DUE';
    periodStart: string;
    // Null: not billed (Gratis, or the operator's plan).
    periodEnd: string | null;
    extraSeats: number;
    // What the renewal brings in, from the period end (ADR-030).
    pending: { plan: Named | null; interval: 'MONTHLY' | 'YEARLY' | null; seats: number | null };
  };
  plans: (Named & { monthly: string; yearly: string })[];
  addOns: (Named & {
    monthly: string;
    // Bought and kept, bought and leaving at the period end, or not bought.
    state: 'ACTIVE' | 'LEAVING' | 'AVAILABLE';
  })[];
  seatMonthly: string | null;
  packs: { size: number; price: string }[];
  packsLeft: number;
  payments: PaymentView[];
};

export async function billingOverview(ctx: ActorContext, db: Database): Promise<BillingOverview> {
  requirePermission(ctx, 'billing.read');
  const today = ecuadorDate(ctx.clock.now());
  return inCompany(ctx, db, async ({ db: tx }, tenantId) => {
    const { plans, modules, planModules, subscriptionItems, prices } = schema;
    const [subscription] = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, tenantId));
    if (!subscription) throw new Error(`Tenant ${tenantId} has no subscription`);
    const named = (row: Named) => ({ key: row.key, nameEs: row.nameEs, nameEn: row.nameEn });
    const [current] = await tx.select().from(plans).where(eq(plans.id, subscription.planId));
    const pendingPlan = subscription.pendingPlanId
      ? (await tx.select().from(plans).where(eq(plans.id, subscription.pendingPlanId)))[0]
      : undefined;

    const sold = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.status, 'PUBLISHED'), eq(plans.selfService, true)))
      .orderBy(asc(plans.sortOrder));
    const offered: BillingOverview['plans'] = [];
    for (const plan of sold) {
      const price = await priceOn(tx, { kind: 'PLAN', planId: plan.id }, today);
      // A free plan is reached by cancelling, never bought.
      if (price === null || !price.gt(0)) continue;
      offered.push({
        ...named(plan),
        monthly: price.toFixed(2),
        yearly: price.mul(YEARLY_MONTHS).toFixed(2),
      });
    }

    const inPlan = new Set(
      (
        await tx
          .select({ moduleId: planModules.moduleId })
          .from(planModules)
          .where(and(eq(planModules.planId, subscription.planId), isNull(planModules.removesAt)))
      ).map((row) => row.moduleId),
    );
    const items = await tx
      .select({ moduleId: subscriptionItems.moduleId, removesAt: subscriptionItems.removesAt })
      .from(subscriptionItems)
      .where(
        and(
          eq(subscriptionItems.subscriptionId, subscription.id),
          eq(subscriptionItems.kind, 'MODULE'),
          eq(subscriptionItems.active, true),
        ),
      );
    const sellable = await tx
      .select()
      .from(modules)
      .where(and(eq(modules.status, 'AVAILABLE'), eq(modules.isBase, false)))
      .orderBy(asc(modules.sortOrder));
    const addOns: BillingOverview['addOns'] = [];
    for (const module of sellable) {
      if (inPlan.has(module.id)) continue;
      const price = await priceOn(tx, { kind: 'MODULE', moduleId: module.id }, today);
      if (price === null) continue;
      const item = items.find((row) => row.moduleId === module.id);
      addOns.push({
        ...named(module),
        monthly: price.toFixed(2),
        state: !item ? 'AVAILABLE' : item.removesAt ? 'LEAVING' : 'ACTIVE',
      });
    }

    const seat = await priceOn(tx, { kind: 'SEAT' }, today);
    const sizes = await tx
      .selectDistinct({ size: prices.packSize })
      .from(prices)
      .where(eq(prices.kind, 'PACK'));
    const packs: BillingOverview['packs'] = [];
    for (const { size } of sizes) {
      const price = await priceOn(tx, { kind: 'PACK', packSize: size! }, today);
      if (price !== null) packs.push({ size: size!, price: price.toFixed(2) });
    }
    packs.sort((a, b) => a.size - b.size);

    return {
      subscription: {
        billing: subscription.billing,
        planKey: current!.key,
        interval: subscription.interval,
        status: subscription.status,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
        extraSeats: subscription.extraSeats,
        pending: {
          plan: pendingPlan ? named(pendingPlan) : null,
          interval: subscription.pendingInterval,
          seats: subscription.pendingSeats,
        },
      },
      plans: offered,
      addOns,
      seatMonthly: seat?.toFixed(2) ?? null,
      packs,
      packsLeft: await packBalance(tx, tenantId),
      payments: await listPaymentsIn(tx, tenantId),
    };
  });
}
