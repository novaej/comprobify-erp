import { and, eq, inArray, schema, sql, type Database, type Tx } from '@comprobify/db';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { applySubscriptionTerm, CUSTOM_PLAN_KEY } from '../entitlements';
import { assertSuperAdmin } from '../identity';
import { Dec, DomainError, ecuadorDate, type PlatformActor } from '../kernel';
import { companyRow } from '../tenancy';
import { remainingShare } from './changes';
import { ivaRateOn } from './iva';
import { notifyBilling, type BillingNotice } from './notify';
import {
  amountsOf,
  monthlyCharge,
  OPEN,
  openInitialPayment,
  paidRenewalFor,
  paymentCode,
  repriceRenewal,
  subscriptionOf,
  termOf,
  viewsOf,
  type PaymentView,
} from './payments';
import { YEARLY_MONTHS } from './prices';

// ADR-035: Personalizado, billed. The operator negotiates its monthly price, its modules and its
// limits; the company pays it like any plan, by transfer or card, and renews at that price.

const realTenantId = z.uuid();

async function customPlan(tx: Tx['db']) {
  const [plan] = await tx
    .select({ id: schema.plans.id, key: schema.plans.key })
    .from(schema.plans)
    .where(eq(schema.plans.key, CUSTOM_PLAN_KEY));
  if (!plan) throw new Error('Personalizado is missing: run the migrate step');
  return plan;
}

export const startCustomBillingInput = z.object({
  realTenantId,
  interval: z.enum(['MONTHLY', 'YEARLY']),
});

// A company on Personalizado with no paid period: its first payment, at the negotiated price.
export async function startCustomBilling(
  actor: PlatformActor,
  db: Database,
  raw: z.input<typeof startCustomBillingInput>,
): Promise<PaymentView> {
  await assertSuperAdmin(db.identity, actor);
  const input = startCustomBillingInput.parse(raw);
  const today = ecuadorDate(actor.clock.now());
  return db.withSystem('super admin: start billing Personalizado', async ({ db: tx }) => {
    const company = await companyRow(tx, input.realTenantId);
    const subscription = await subscriptionOf(tx, company.realTenantId);
    const plan = await customPlan(tx);
    if (subscription.planId !== plan.id)
      throw new DomainError('NOT_CUSTOM_PLAN', 'Move the company to Personalizado first');
    if (subscription.billing === 'COMPLIMENTARY')
      throw new DomainError(
        'SUBSCRIPTION_COMPLIMENTARY',
        'A complimentary company is never charged',
      );
    if (subscription.periodEnd !== null)
      throw new DomainError('ALREADY_BILLED', 'The company already has a paid period');
    const row = await openInitialPayment(tx, {
      subscription,
      plan,
      interval: input.interval,
      today,
      createdBy: actor.userId,
    });
    await recordAudit(tx, {
      tenantId: company.realTenantId,
      actorUserId: actor.userId,
      action: 'subscription.custom_billing_started',
      details: { code: row.code, interval: input.interval, total: row.totalAmount },
    });
    return (await viewsOf(tx, [row]))[0]!;
  });
}

export const moveToCustomInput = z.object({
  realTenantId,
  // The negotiated monthly price before IVA, a decimal string (rule 14).
  monthlyPrice: z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/),
});

export type MoveToCustom =
  { when: 'NOW'; payment: PaymentView } | { when: 'PERIOD_END'; effectiveOn: string };

// A company paying for a plan moves to Personalizado. Costing more, the difference for the days
// left is paid now and it switches once paid; costing the same or less, it keeps the plan it paid
// for and switches at the period end. Its cycle stays monthly or yearly as it is.
export async function moveToCustom(
  actor: PlatformActor,
  db: Database,
  raw: z.input<typeof moveToCustomInput>,
  notice: BillingNotice,
): Promise<MoveToCustom> {
  await assertSuperAdmin(db.identity, actor);
  const input = moveToCustomInput.parse(raw);
  const now = actor.clock.now();
  const today = ecuadorDate(now);
  return db.withSystem('super admin: move a company to Personalizado', async (txAll) => {
    const tx = txAll.db;
    const company = await companyRow(tx, input.realTenantId);
    const tenants = { realTenantId: company.realTenantId, twinTenantId: company.twinTenantId };
    const subscription = await subscriptionOf(tx, company.realTenantId);
    const plan = await customPlan(tx);
    if (subscription.planId === plan.id)
      throw new DomainError('SAME_PLAN', 'The company is on Personalizado');
    if (subscription.billing === 'COMPLIMENTARY')
      throw new DomainError(
        'SUBSCRIPTION_COMPLIMENTARY',
        'A complimentary company is never charged',
      );
    if (subscription.periodEnd === null || subscription.status !== 'ACTIVE')
      throw new DomainError('NOT_BILLED', 'Only a company paying an active period moves this way');
    const periodEnd = subscription.periodEnd;
    if (await paidRenewalFor(tx, company.realTenantId, periodEnd))
      throw new DomainError('RENEWAL_ALREADY_PAID', 'The next period is paid; move it after');
    const open = await tx
      .select({ purpose: schema.payments.purpose })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.tenantId, company.realTenantId),
          inArray(schema.payments.status, OPEN),
        ),
      );
    if (open.some((payment) => payment.purpose !== 'RENEWAL'))
      throw new DomainError('PAYMENT_IN_PROGRESS', 'Another payment is still open');

    // What it pays a month now, against the negotiated price.
    const current = await monthlyCharge(tx, {
      subscriptionId: subscription.id,
      planId: subscription.planId,
      seats: subscription.extraSeats,
      on: today,
      until: periodEnd,
    });
    const negotiated = new Dec(input.monthlyPrice);
    for (const tenantId of [tenants.realTenantId, tenants.twinTenantId])
      await tx
        .update(schema.subscriptions)
        .set({ negotiatedMonthlyPrice: negotiated.toFixed(2), updatedAt: sql`now()` })
        .where(eq(schema.subscriptions.tenantId, tenantId));

    if (negotiated.gt(current.total)) {
      const months = subscription.interval === 'YEARLY' ? YEARLY_MONTHS : 1;
      const share = remainingShare(subscription.periodStart, periodEnd, today);
      const [row] = await tx
        .insert(schema.payments)
        .values({
          tenantId: company.realTenantId,
          subscriptionId: subscription.id,
          code: paymentCode(),
          purpose: 'TIER_CHANGE',
          targetPlanId: plan.id,
          targetInterval: subscription.interval,
          ...amountsOf(
            negotiated.sub(current.total).mul(months).mul(share),
            await ivaRateOn(tx, today),
          ),
          pricing: {
            model: 'MOVE_TO_CUSTOM',
            current: current.lines,
            negotiated: negotiated.toFixed(2),
            months,
            share: share.toFixed(6),
          },
          createdBy: actor.userId,
        })
        .returning();
      await recordAudit(tx, {
        tenantId: company.realTenantId,
        actorUserId: actor.userId,
        action: 'subscription.moved_to_custom',
        details: { when: 'NOW', code: row!.code, price: negotiated.toFixed(2) },
      });
      return { when: 'NOW', payment: (await viewsOf(tx, [row!]))[0]! };
    }

    await applySubscriptionTerm(tx, tenants, {
      ...termOf(subscription),
      pendingPlanId: plan.id,
      pendingInterval: null,
      pendingSeats: null,
    });
    await recordAudit(tx, {
      tenantId: company.realTenantId,
      actorUserId: actor.userId,
      action: 'subscription.moved_to_custom',
      details: { when: 'PERIOD_END', effectiveOn: periodEnd, price: negotiated.toFixed(2) },
    });
    await repriceAndTell(txAll, company.realTenantId, now, notice);
    return { when: 'PERIOD_END', effectiveOn: periodEnd };
  });
}

// A renewal nobody has paid yet is priced again with what is now due, and the payer is told.
// One already reported waits for the operator, who invoices it by hand.
export async function repriceAndTell(
  txAll: Tx,
  tenantId: string,
  now: Date,
  notice: BillingNotice,
): Promise<void> {
  const tx = txAll.db;
  const [open] = await tx
    .select({ status: schema.payments.status })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, tenantId),
        eq(schema.payments.purpose, 'RENEWAL'),
        inArray(schema.payments.status, OPEN),
      ),
    );
  if (!open || open.status === 'REPORTED') return;
  await repriceRenewal(tx, tenantId, now);
  const [renewal] = await tx
    .select({ total: schema.payments.totalAmount })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, tenantId),
        eq(schema.payments.purpose, 'RENEWAL'),
        inArray(schema.payments.status, OPEN),
      ),
    );
  if (renewal)
    await notifyBilling(txAll, notice, tenantId, {
      template: 'renewalRepriced',
      date: ecuadorDate(now),
      amount: renewal.total,
    });
}
