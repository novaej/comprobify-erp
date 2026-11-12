import { and, asc, eq, gt, inArray, isNull, schema, type Database } from '@comprobify/db';
import { ecuadorDate } from '../kernel';
import { priceOn, YEARLY_MONTHS } from './prices';

// FR-UX-5: what the public pricing page shows, read from the same prices and plans the billing
// page sells, so an edit in the platform area reaches the page with no code change (ADR-027).

type Named = { key: string; nameEs: string; nameEn: string };

export type PublicPlan = Named & {
  // Before IVA, in dollars. Yearly is the monthly price for YEARLY_MONTHS months (FR-BILL-1).
  monthly: string;
  yearly: string;
  // A published rise or cut that has not started yet, by its monthly price.
  upcoming: { monthly: string; on: string } | null;
  // Null is unlimited.
  limits: {
    documents: number | null;
    users: number | null;
    branches: number | null;
    issuePoints: number | null;
  };
  modules: Named[];
};

export type PublicPricing = {
  plans: PublicPlan[];
  addOns: (Named & { monthly: string })[];
  seatMonthly: string | null;
};

const LIMIT_KEYS = {
  documents: 'DOCUMENT_QUOTA',
  users: 'USERS',
  branches: 'MAX_BRANCHES',
  issuePoints: 'MAX_ISSUE_POINTS_PER_BRANCH',
} as const;

export async function publicPricing(db: Database, now: Date): Promise<PublicPricing> {
  const today = ecuadorDate(now);
  return db.withSystem('public pricing page', async ({ db: tx }) => {
    const { plans, modules, planModules, planLimits, prices } = schema;
    const named = (row: Named) => ({ key: row.key, nameEs: row.nameEs, nameEn: row.nameEn });

    const sold = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.status, 'PUBLISHED'), eq(plans.selfService, true)))
      .orderBy(asc(plans.sortOrder));
    const planIds = sold.map((plan) => plan.id);
    const limitRows = planIds.length
      ? await tx.select().from(planLimits).where(inArray(planLimits.planId, planIds))
      : [];
    const moduleRows = planIds.length
      ? await tx
          .select({ planId: planModules.planId, module: modules })
          .from(planModules)
          .innerJoin(modules, eq(modules.id, planModules.moduleId))
          .where(
            and(
              inArray(planModules.planId, planIds),
              isNull(planModules.removesAt),
              eq(modules.status, 'AVAILABLE'),
            ),
          )
          .orderBy(asc(modules.sortOrder))
      : [];

    const result: PublicPlan[] = [];
    for (const plan of sold) {
      const price = await priceOn(tx, { kind: 'PLAN', planId: plan.id }, today);
      // Nothing priced yet: not offered rather than shown at a made-up price.
      if (price === null) continue;
      const [next] = await tx
        .select({ amount: prices.amount, on: prices.effectiveOn })
        .from(prices)
        .where(
          and(
            eq(prices.kind, 'PLAN'),
            eq(prices.planId, plan.id),
            eq(prices.status, 'PUBLISHED'),
            gt(prices.effectiveOn, today),
          ),
        )
        .orderBy(asc(prices.effectiveOn))
        .limit(1);
      const limit = (key: string) =>
        limitRows.find((row) => row.planId === plan.id && row.featureKey === key)?.value ?? null;
      result.push({
        ...named(plan),
        monthly: price.toFixed(2),
        yearly: price.mul(YEARLY_MONTHS).toFixed(2),
        upcoming:
          next?.amount != null && next.on
            ? { monthly: Number(next.amount).toFixed(2), on: next.on }
            : null,
        limits: {
          documents: limit(LIMIT_KEYS.documents),
          users: limit(LIMIT_KEYS.users),
          branches: limit(LIMIT_KEYS.branches),
          issuePoints: limit(LIMIT_KEYS.issuePoints),
        },
        modules: moduleRows.filter((row) => row.planId === plan.id).map((row) => named(row.module)),
      });
    }

    const sellable = await tx
      .select()
      .from(modules)
      .where(and(eq(modules.status, 'AVAILABLE'), eq(modules.isBase, false)))
      .orderBy(asc(modules.sortOrder));
    const addOns: PublicPricing['addOns'] = [];
    for (const module of sellable) {
      const price = await priceOn(tx, { kind: 'MODULE', moduleId: module.id }, today);
      if (price !== null) addOns.push({ ...named(module), monthly: price.toFixed(2) });
    }
    const seat = await priceOn(tx, { kind: 'SEAT' }, today);

    return { plans: result, addOns, seatMonthly: seat ? seat.toFixed(2) : null };
  });
}
