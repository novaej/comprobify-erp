import {
  and,
  eq,
  inArray,
  isNull,
  schema,
  type BillingInterval,
  type Database,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { applyRemoveModule, applySubscriptionTerm } from '../entitlements';
import {
  daysBetween,
  Dec,
  DomainError,
  ecuadorDate,
  requirePermission,
  startOfEcuadorDay,
  type ActorContext,
} from '../kernel';
import { companyRow } from '../tenancy';
import {
  amountsOf,
  applyChange,
  forCompany,
  inCompany,
  monthlyCharge,
  OPEN,
  paymentCode,
  repriceRenewal,
  subscriptionOf,
  termOf,
  viewsOf,
  type BillingDeps,
  type Change,
  type PaymentView,
} from './payments';
import { priceOn, YEARLY_MONTHS } from './prices';

// FR-BILL-5, FR-PLAN-1a (ADR-030): what a paying company changes on its own subscription.
// Upgrades, seats and add-ons are prorated and take effect once paid; downgrades, yearly to
// monthly and fewer seats wait for the period end and are charged by the renewal. An amount is
// never negative: there is no refund to the company.

type SubscriptionRow = typeof schema.subscriptions.$inferSelect;

const monthsOf = (interval: BillingInterval) => (interval === 'YEARLY' ? YEARLY_MONTHS : 1);

// How much of the period is left, by Ecuador days.
export function remainingShare(periodStart: string, periodEnd: string, today: string): Dec {
  const total = daysBetween(periodStart, periodEnd);
  const left = Math.min(Math.max(daysBetween(today, periodEnd), 0), total);
  return total > 0 ? new Dec(left).div(total) : new Dec(0);
}

// The quote for a change: what it costs now, if anything, and when it takes effect.
export type ChangeQuote =
  | { when: 'NOW'; amount: Dec; pricing: Record<string, unknown> }
  | { when: 'PERIOD_END'; effectiveOn: string; pricing: Record<string, unknown> };

// Changes are for a company that pays for a period and keeps paying for it.
function requireBilledActive(subscription: SubscriptionRow) {
  if (subscription.billing === 'COMPLIMENTARY')
    throw new DomainError('SUBSCRIPTION_COMPLIMENTARY', 'A complimentary company is never charged');
  if (subscription.periodEnd === null)
    throw new DomainError('NOT_BILLED', 'Start a paid plan first');
  if (subscription.status === 'CANCELLED')
    throw new DomainError('SUBSCRIPTION_CANCELLED', 'Resume the subscription first');
  if (subscription.status === 'PAST_DUE')
    throw new DomainError('ACCOUNT_PAST_DUE', 'Pay the renewal first');
  return subscription as SubscriptionRow & { periodEnd: string };
}

async function requireNoOpenChange(tx: Tx['db'], tenantId: string) {
  const open = await tx
    .select({ purpose: schema.payments.purpose })
    .from(schema.payments)
    .where(and(eq(schema.payments.tenantId, tenantId), inArray(schema.payments.status, OPEN)));
  if (open.some((payment) => payment.purpose !== 'RENEWAL'))
    throw new DomainError('PAYMENT_IN_PROGRESS', 'Another payment is still open');
}

export const planChangeInput = z.object({
  planKey: z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/),
  interval: z.enum(['MONTHLY', 'YEARLY']),
});
export type PlanChangeInput = z.input<typeof planChangeInput>;

async function quotePlan(
  tx: Tx['db'],
  subscription: SubscriptionRow & { periodEnd: string },
  input: z.output<typeof planChangeInput>,
  today: string,
): Promise<{ planId: string; quote: ChangeQuote }> {
  const [plan] = await tx.select().from(schema.plans).where(eq(schema.plans.key, input.planKey));
  if (!plan || plan.status !== 'PUBLISHED' || !plan.selfService)
    throw new DomainError('PLAN_NOT_SOLD', 'That plan is not sold');
  if (plan.id === subscription.planId && input.interval === subscription.interval)
    throw new DomainError('SAME_PLAN', 'The company is on that plan');
  const seats = subscription.extraSeats;
  const now = await monthlyCharge(tx, {
    subscriptionId: subscription.id,
    planId: subscription.planId,
    seats,
    on: today,
  });
  const next = await monthlyCharge(tx, {
    subscriptionId: subscription.id,
    planId: plan.id,
    seats,
    on: today,
  });
  // Going to a free plan is leaving: that is a cancellation.
  const planPrice = await priceOn(tx, { kind: 'PLAN', planId: plan.id }, today);
  if (planPrice === null || !planPrice.gt(0))
    throw new DomainError('USE_CANCEL', 'Cancel the subscription to go back to a free plan');
  const share = remainingShare(subscription.periodStart, subscription.periodEnd, today);
  const atEnd: ChangeQuote = {
    when: 'PERIOD_END',
    effectiveOn: subscription.periodEnd,
    pricing: { model: 'AT_PERIOD_END', current: now.lines, next: next.lines },
  };
  if (input.interval === subscription.interval) {
    if (!next.total.gt(now.total)) return { planId: plan.id, quote: atEnd };
    // The difference for what is left of the period, at the period's own length.
    const months = monthsOf(subscription.interval);
    const amount = next.total.sub(now.total).mul(months).mul(share);
    return {
      planId: plan.id,
      quote: {
        when: 'NOW',
        amount,
        pricing: {
          model: 'PRORATED_UPGRADE',
          current: now.lines,
          next: next.lines,
          months,
          share: share.toFixed(6),
        },
      },
    };
  }
  // Monthly to yearly is worth doing now when the year costs more a month than the month does:
  // the unused part of the month is credited (ADR-030). Anything else waits for the period end.
  if (subscription.interval === 'MONTHLY' && next.total.mul(YEARLY_MONTHS).div(12).gt(now.total)) {
    const credit = now.total.mul(share);
    const amount = Dec.max(next.total.mul(YEARLY_MONTHS).sub(credit), 0);
    return {
      planId: plan.id,
      quote: {
        when: 'NOW',
        amount,
        pricing: {
          model: 'TO_YEARLY_NOW',
          next: next.lines,
          months: YEARLY_MONTHS,
          credit: credit.toFixed(2),
          share: share.toFixed(6),
        },
      },
    };
  }
  return { planId: plan.id, quote: atEnd };
}

export type ChangeResult =
  { applied: 'NOW'; payment: PaymentView | null } | { applied: 'PERIOD_END'; effectiveOn: string };

// A payment for a change, or the change itself when it costs nothing after rounding.
async function chargeOrApply(
  ctx: ActorContext,
  tx: Tx['db'],
  subscription: SubscriptionRow,
  change: Change,
  quote: { amount: Dec; pricing: Record<string, unknown> },
  deps: BillingDeps,
): Promise<ChangeResult> {
  const amounts = amountsOf(quote.amount, deps.ivaRate);
  if (!new Dec(amounts.baseAmount).gt(0)) {
    await applyChange(tx, subscription.tenantId, change, ctx.clock.now());
    await recordAudit(tx, {
      tenantId: subscription.tenantId,
      actorUserId: ctx.userId ?? null,
      action: 'subscription.change_scheduled',
      details: { purpose: change.purpose, when: 'NOW', amount: '0.00' },
    });
    return { applied: 'NOW', payment: null };
  }
  const [row] = await tx
    .insert(schema.payments)
    .values({
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      code: paymentCode(),
      ...change,
      ...amounts,
      pricing: quote.pricing,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  await recordAudit(tx, {
    tenantId: subscription.tenantId,
    actorUserId: ctx.userId ?? null,
    action: 'payment.created',
    details: { code: row!.code, purpose: change.purpose },
  });
  return { applied: 'NOW', payment: (await viewsOf(tx, [row!]))[0]! };
}

// What a plan or interval change would do, for the confirmation the company sees.
export async function previewPlanChange(
  ctx: ActorContext,
  db: Database,
  raw: PlanChangeInput,
  deps: BillingDeps,
): Promise<
  | { when: 'NOW'; amounts: ReturnType<typeof amountsOf> }
  | { when: 'PERIOD_END'; effectiveOn: string }
> {
  requirePermission(ctx, 'billing.read');
  const input = planChangeInput.parse(raw);
  const today = ecuadorDate(ctx.clock.now());
  return inCompany(ctx, db, async (tx, tenantId) => {
    const subscription = requireBilledActive(await subscriptionOf(tx.db, tenantId));
    const { quote } = await quotePlan(tx.db, subscription, input, today);
    return quote.when === 'NOW'
      ? { when: 'NOW', amounts: amountsOf(quote.amount, deps.ivaRate) }
      : { when: 'PERIOD_END', effectiveOn: quote.effectiveOn };
  });
}

export async function requestPlanChange(
  ctx: ActorContext,
  db: Database,
  raw: PlanChangeInput,
  deps: BillingDeps,
): Promise<ChangeResult> {
  requirePermission(ctx, 'billing.manage');
  const input = planChangeInput.parse(raw);
  const today = ecuadorDate(ctx.clock.now());
  return forCompany(ctx, db, 'company: change its plan', async (tx, tenantId) => {
    const subscription = requireBilledActive(await subscriptionOf(tx.db, tenantId));
    await requireNoOpenChange(tx.db, tenantId);
    const { planId, quote } = await quotePlan(tx.db, subscription, input, today);
    // A new yearly period from today makes the month's renewal moot once paid; one being
    // reviewed is settled first.
    if (quote.when === 'NOW' && input.interval !== subscription.interval) {
      const [reported] = await tx.db
        .select({ id: schema.payments.id })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.tenantId, tenantId),
            eq(schema.payments.purpose, 'RENEWAL'),
            eq(schema.payments.status, 'REPORTED'),
          ),
        );
      if (reported)
        throw new DomainError(
          'RENEWAL_IN_REVIEW',
          'The renewal is being reviewed; change it after',
        );
    }
    if (quote.when === 'NOW')
      return chargeOrApply(
        ctx,
        tx.db,
        subscription,
        {
          purpose: 'TIER_CHANGE',
          targetPlanId: planId,
          targetInterval: input.interval,
          targetSeats: null,
          targetModuleId: null,
        },
        quote,
        deps,
      );
    await schedule(ctx, tx.db, subscription, deps, {
      pendingPlanId: planId === subscription.planId ? null : planId,
      pendingInterval: input.interval === subscription.interval ? null : input.interval,
    });
    return { applied: 'PERIOD_END', effectiveOn: quote.effectiveOn };
  });
}

// A change due at the period end, which the renewal then charges and applies.
async function schedule(
  ctx: ActorContext,
  tx: Tx['db'],
  subscription: SubscriptionRow,
  deps: BillingDeps,
  pending: Partial<Pick<SubscriptionRow, 'pendingPlanId' | 'pendingInterval' | 'pendingSeats'>>,
) {
  const row = await companyRow(tx, subscription.tenantId);
  await applySubscriptionTerm(
    tx,
    { realTenantId: row.realTenantId, twinTenantId: row.twinTenantId },
    { ...termOf(subscription), ...pending },
  );
  await repriceRenewal(tx, subscription.tenantId, deps, ctx.clock.now());
  await recordAudit(tx, {
    tenantId: subscription.tenantId,
    actorUserId: ctx.userId ?? null,
    action: 'subscription.change_scheduled',
    details: {
      when: 'PERIOD_END',
      effectiveOn: subscription.periodEnd,
      plan: pending.pendingPlanId ?? null,
      interval: pending.pendingInterval ?? null,
      seats: pending.pendingSeats ?? null,
    },
  });
}

// Drops whatever was due at the period end: the company keeps what it has.
export async function cancelScheduledChange(
  ctx: ActorContext,
  db: Database,
  deps: BillingDeps,
): Promise<void> {
  requirePermission(ctx, 'billing.manage');
  await forCompany(
    ctx,
    db,
    'company: drop a change due at the period end',
    async (tx, tenantId) => {
      const subscription = requireBilledActive(await subscriptionOf(tx.db, tenantId));
      await schedule(ctx, tx.db, subscription, deps, {
        pendingPlanId: null,
        pendingInterval: null,
        pendingSeats: null,
      });
    },
  );
}

export const seatsInput = z.object({ extraSeats: z.int().min(0).max(1000) });

// FR-PLAN-1a: users above the plan's limit. More are prorated and paid now; fewer wait for the
// period end, since this one is paid for.
export async function requestSeats(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof seatsInput>,
  deps: BillingDeps,
): Promise<ChangeResult> {
  requirePermission(ctx, 'billing.manage');
  const input = seatsInput.parse(raw);
  const today = ecuadorDate(ctx.clock.now());
  return forCompany(ctx, db, 'company: change its extra users', async (tx, tenantId) => {
    const subscription = requireBilledActive(await subscriptionOf(tx.db, tenantId));
    await requireNoOpenChange(tx.db, tenantId);
    const current = subscription.extraSeats;
    if (input.extraSeats === current) {
      if (subscription.pendingSeats === null)
        throw new DomainError('SAME_SEATS', 'The company already has those seats');
      await schedule(ctx, tx.db, subscription, deps, { pendingSeats: null });
      return { applied: 'NOW', payment: null };
    }
    if (input.extraSeats < current) {
      await schedule(ctx, tx.db, subscription, deps, { pendingSeats: input.extraSeats });
      return { applied: 'PERIOD_END', effectiveOn: subscription.periodEnd };
    }
    const seat = await priceOn(tx.db, { kind: 'SEAT' }, today);
    if (seat === null) throw new DomainError('PLAN_NOT_SOLD', 'Extra users have no price');
    const months = monthsOf(subscription.interval);
    const share = remainingShare(subscription.periodStart, subscription.periodEnd, today);
    const added = input.extraSeats - current;
    return chargeOrApply(
      ctx,
      tx.db,
      subscription,
      {
        purpose: 'SEAT_CHANGE',
        targetPlanId: null,
        targetInterval: null,
        targetSeats: input.extraSeats,
        targetModuleId: null,
      },
      {
        amount: seat.mul(added).mul(months).mul(share),
        pricing: {
          model: 'PRORATED_SEATS',
          seat: seat.toFixed(2),
          added,
          months,
          share: share.toFixed(6),
        },
      },
      deps,
    );
  });
}

export const addOnInput = z.object({ moduleKey: z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/) });

// FR-PLAN-1a: an add-on the company buys, prorated for what is left of the period.
export async function buyAddOn(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof addOnInput>,
  deps: BillingDeps,
): Promise<ChangeResult> {
  requirePermission(ctx, 'billing.manage');
  const input = addOnInput.parse(raw);
  const today = ecuadorDate(ctx.clock.now());
  return forCompany(ctx, db, 'company: buy an add-on', async (tx, tenantId) => {
    const subscription = requireBilledActive(await subscriptionOf(tx.db, tenantId));
    await requireNoOpenChange(tx.db, tenantId);
    const [module] = await tx.db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.key, input.moduleKey));
    if (!module || module.status !== 'AVAILABLE' || module.isBase)
      throw new DomainError('MODULE_NOT_AVAILABLE', 'That module can not be added');
    const [inPlan] = await tx.db
      .select({ moduleId: schema.planModules.moduleId })
      .from(schema.planModules)
      .where(
        and(
          eq(schema.planModules.planId, subscription.planId),
          eq(schema.planModules.moduleId, module.id),
          isNull(schema.planModules.removesAt),
        ),
      );
    if (inPlan) throw new DomainError('MODULE_IN_PLAN', 'The plan already includes that module');
    const [item] = await tx.db
      .select({ removesAt: schema.subscriptionItems.removesAt })
      .from(schema.subscriptionItems)
      .where(
        and(
          eq(schema.subscriptionItems.subscriptionId, subscription.id),
          eq(schema.subscriptionItems.moduleId, module.id),
          eq(schema.subscriptionItems.active, true),
        ),
      );
    if (item && !item.removesAt)
      throw new DomainError('MODULE_ALREADY_ADDED', 'The company already has that module');
    const change: Change = {
      purpose: 'ADD_ON',
      targetPlanId: null,
      targetInterval: null,
      targetSeats: null,
      targetModuleId: module.id,
    };
    // Still paid for this period, only due to leave: keeping it costs nothing now.
    if (item) {
      await applyChange(tx.db, tenantId, change, ctx.clock.now());
      await repriceRenewal(tx.db, tenantId, deps, ctx.clock.now());
      return { applied: 'NOW', payment: null };
    }
    const price = await priceOn(tx.db, { kind: 'MODULE', moduleId: module.id }, today);
    if (price === null) throw new DomainError('PLAN_NOT_SOLD', 'That module has no price');
    const months = monthsOf(subscription.interval);
    const share = remainingShare(subscription.periodStart, subscription.periodEnd, today);
    return chargeOrApply(
      ctx,
      tx.db,
      subscription,
      change,
      {
        amount: price.mul(months).mul(share),
        pricing: {
          model: 'PRORATED_ADD_ON',
          module: module.key,
          monthly: price.toFixed(2),
          months,
          share: share.toFixed(6),
        },
      },
      deps,
    );
  });
}

// The add-on stays until the period ends, which is paid for, and the renewal leaves it out.
export async function dropAddOn(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof addOnInput>,
  deps: BillingDeps,
): Promise<{ effectiveOn: string }> {
  requirePermission(ctx, 'billing.manage');
  const input = addOnInput.parse(raw);
  return forCompany(ctx, db, 'company: drop an add-on at the period end', async (tx, tenantId) => {
    const subscription = requireBilledActive(await subscriptionOf(tx.db, tenantId));
    const row = await companyRow(tx.db, tenantId);
    await applyRemoveModule(
      tx.db,
      { realTenantId: row.realTenantId, twinTenantId: row.twinTenantId },
      input,
      startOfEcuadorDay(subscription.periodEnd),
    );
    await repriceRenewal(tx.db, tenantId, deps, ctx.clock.now());
    await recordAudit(tx.db, {
      tenantId,
      actorUserId: ctx.userId ?? null,
      action: 'subscription.change_scheduled',
      details: {
        when: 'PERIOD_END',
        effectiveOn: subscription.periodEnd,
        removes: input.moduleKey,
      },
    });
    return { effectiveOn: subscription.periodEnd };
  });
}

// FR-BILL-5: the company stops paying. It keeps what it paid for until the period ends, when it
// goes back to the free plan (the daily job, step 5), and may change its mind until then.
export async function cancelSubscription(
  ctx: ActorContext,
  db: Database,
  deps: BillingDeps,
): Promise<{ effectiveOn: string }> {
  requirePermission(ctx, 'billing.manage');
  return forCompany(ctx, db, 'company: cancel its subscription', async (tx, tenantId) => {
    const subscription = requireBilledActive(await subscriptionOf(tx.db, tenantId));
    await requireNoOpenChange(tx.db, tenantId);
    const row = await companyRow(tx.db, tenantId);
    await applySubscriptionTerm(
      tx.db,
      { realTenantId: row.realTenantId, twinTenantId: row.twinTenantId },
      { ...termOf(subscription), status: 'CANCELLED' },
    );
    // Nothing is renewed now: an unpaid renewal goes away.
    await repriceRenewal(tx.db, tenantId, deps, ctx.clock.now());
    await recordAudit(tx.db, {
      tenantId,
      actorUserId: ctx.userId ?? null,
      action: 'subscription.cancelled',
      details: { effectiveOn: subscription.periodEnd },
    });
    return { effectiveOn: subscription.periodEnd };
  });
}

export async function resumeSubscription(ctx: ActorContext, db: Database): Promise<void> {
  requirePermission(ctx, 'billing.manage');
  await forCompany(ctx, db, 'company: resume its subscription', async (tx, tenantId) => {
    const subscription = await subscriptionOf(tx.db, tenantId);
    if (subscription.status !== 'CANCELLED')
      throw new DomainError('NOT_CANCELLED', 'The subscription is not cancelled');
    const row = await companyRow(tx.db, tenantId);
    await applySubscriptionTerm(
      tx.db,
      { realTenantId: row.realTenantId, twinTenantId: row.twinTenantId },
      { ...termOf(subscription), status: 'ACTIVE' },
    );
    await recordAudit(tx.db, {
      tenantId,
      actorUserId: ctx.userId ?? null,
      action: 'subscription.resumed',
      details: { periodEnd: subscription.periodEnd },
    });
  });
}
