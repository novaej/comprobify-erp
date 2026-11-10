import type { Logger } from '@comprobify/config/logger';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  schema,
  type Database,
  type Tx,
} from '@comprobify/db';
import { findAuditEvent, recordAudit, type AuditAction } from '../audit';
import {
  applyDropAllAddOns,
  applySubscriptionTerm,
  DEFAULT_PLAN_KEY,
  type CompanyTenants,
} from '../entitlements';
import type { EmailTemplate } from '../email';
import type { Jobs } from '../jobs';
import { addDays, Dec, ecuadorDate, type Clock } from '../kernel';
import { billingContacts, companyRow } from '../tenancy';
import { ivaRateOn } from './iva';
import { amountsOf, lockPayment, OPEN, openRenewal, subscriptionOf, termOf } from './payments';

// FR-BILL-5 (ADR-032): the renewal cycle, once a day. Each step reads the subscription as it is
// now and does only what is still due, so a second run, or a run after missed days, is harmless
// (NFR-JOB-1). Every step the company goes through is emailed to its owners and admins.
export const BILLING_DAYS = {
  // The renewal opens, and the company hears of it, this long before the period ends.
  renewalNotice: 7,
  // After the period ends unpaid: full access this long, then past due.
  grace: 7,
  // Past due this long, then back on the free plan.
  pastDue: 14,
} as const;

export type BillingDayDeps = {
  db: Database;
  jobs: Pick<Jobs, 'enqueue'>;
  clock: Clock;
  logger: Logger;
  // Where the emails' button points: the company's plan page.
  appUrl: string;
};

export type BillingDayResult = {
  // Unpaid payments charged again at a new IVA rate (ADR-034).
  repriced: number;
  renewalsOpened: number;
  graceStarted: number;
  pastDue: number;
  movedToFree: number;
};

type Step = Exclude<keyof BillingDayResult, 'repriced'>;

const formatDate = (date: string, locale: 'es' | 'en') =>
  new Intl.DateTimeFormat(locale === 'es' ? 'es-EC' : 'en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

async function notify(
  tx: Tx,
  deps: BillingDayDeps,
  realTenantId: string,
  email: { template: EmailTemplate; date: string; amount: string | null; rate?: string },
): Promise<void> {
  const company = await companyRow(tx.db, realTenantId);
  for (const contact of await billingContacts(tx.db, realTenantId))
    await deps.jobs.enqueue(tx, 'email.send', {
      to: contact.email,
      locale: contact.locale,
      template: email.template,
      params: {
        url: `${deps.appUrl}/${contact.locale}/plan`,
        organization: company.name,
        date: formatDate(email.date, contact.locale),
        ...(email.amount ? { amount: `$${email.amount}` } : {}),
        ...(email.rate ? { rate: `${new Dec(email.rate).toString()} %` } : {}),
      },
    });
}

async function openRenewalOf(tx: Tx['db'], tenantId: string) {
  const [row] = await tx
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, tenantId),
        eq(schema.payments.purpose, 'RENEWAL'),
        inArray(schema.payments.status, OPEN),
      ),
    );
  return row ?? null;
}

// One company's day, in its own transaction: what it reached, or null.
async function runCompany(deps: BillingDayDeps, realTenantId: string): Promise<Step | null> {
  const now = deps.clock.now();
  const today = ecuadorDate(now);
  return deps.db.withSystem('billing: the daily renewal cycle', async (tx) => {
    const subscription = await subscriptionOf(tx.db, realTenantId);
    const end = subscription.periodEnd;
    if (subscription.billing === 'COMPLIMENTARY' || end === null) return null;
    const row = await companyRow(tx.db, realTenantId);
    const company: CompanyTenants = {
      realTenantId: row.realTenantId,
      twinTenantId: row.twinTenantId,
    };
    const record = (action: AuditAction, details: Record<string, string>) =>
      recordAudit(tx.db, { tenantId: realTenantId, actorUserId: null, action, details });

    const toFree = async (reason: 'CANCELLED' | 'UNPAID'): Promise<Step> => {
      const [free] = await tx.db
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(eq(schema.plans.key, DEFAULT_PLAN_KEY));
      // Nothing more is owed for a period that is over, nor for a change to it. A pack stays
      // open: its documents are still worth buying on the free plan.
      await tx.db
        .update(schema.payments)
        .set({ status: 'CANCELLED', cancelledAt: now })
        .where(
          and(
            eq(schema.payments.tenantId, realTenantId),
            inArray(schema.payments.status, ['PENDING', 'REJECTED']),
            ne(schema.payments.purpose, 'DOCUMENT_PACK'),
          ),
        );
      // From the old end, so the free quota's months stay on the same day.
      await applySubscriptionTerm(tx.db, company, {
        ...termOf(subscription),
        planId: free!.id,
        interval: 'MONTHLY',
        status: 'ACTIVE',
        periodStart: end,
        periodEnd: null,
        extraSeats: 0,
        pendingPlanId: null,
        pendingInterval: null,
        pendingSeats: null,
      });
      await applyDropAllAddOns(tx.db, company);
      await record('subscription.moved_to_free', { periodEnd: end, reason });
      await notify(tx, deps, realTenantId, { template: 'movedToFree', date: today, amount: null });
      return 'movedToFree';
    };

    if (subscription.status === 'CANCELLED') return today >= end ? toFree('CANCELLED') : null;

    const graceEnds = addDays(end, BILLING_DAYS.grace);
    // A transfer the company reported waits for the operator: it is never held against it.
    const open = await openRenewalOf(tx.db, realTenantId);
    const [reported] = await tx.db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.tenantId, realTenantId),
          eq(schema.payments.status, 'REPORTED'),
          ne(schema.payments.purpose, 'DOCUMENT_PACK'),
        ),
      )
      .limit(1);
    const inReview = Boolean(reported);

    if (subscription.status === 'PAST_DUE') {
      // Counted from the day it became past due, which a review may have put off.
      const since = await findAuditEvent(tx.db, realTenantId, 'subscription.past_due', {
        periodEnd: end,
      });
      const start = typeof since?.since === 'string' ? since.since : graceEnds;
      const freeOn = addDays(start, BILLING_DAYS.pastDue);
      return today >= freeOn && !inReview ? toFree('UNPAID') : null;
    }

    if (today < addDays(end, -BILLING_DAYS.renewalNotice)) return null;
    if (!open) {
      const opened = await openRenewal(tx.db, realTenantId, now);
      if (!opened) return null;
      await record('subscription.renewal_due', { periodEnd: end, code: opened.code });
      await notify(tx, deps, realTenantId, {
        template: 'renewalDue',
        date: end,
        amount: opened.totalAmount,
      });
      return 'renewalsOpened';
    }
    if (today < end || inReview) return null;
    if (today >= graceEnds) {
      await applySubscriptionTerm(tx.db, company, { ...termOf(subscription), status: 'PAST_DUE' });
      await record('subscription.past_due', { periodEnd: end, since: today });
      await notify(tx, deps, realTenantId, {
        template: 'pastDue',
        date: addDays(today, BILLING_DAYS.pastDue),
        amount: open.totalAmount,
      });
      return 'pastDue';
    }
    if (await findAuditEvent(tx.db, realTenantId, 'subscription.grace_started', { periodEnd: end }))
      return null;
    await record('subscription.grace_started', { periodEnd: end });
    await notify(tx, deps, realTenantId, {
      template: 'graceStarted',
      date: graceEnds,
      amount: open.totalAmount,
    });
    return 'graceStarted';
  });
}

// ADR-034: a new IVA rate has started, so a payment nobody has paid yet charges it, and the payer
// is told the new total. A transfer under review keeps its rate: that money is on its way. One
// with a card attempt still unresolved waits a day, so Payphone confirms what it held.
async function repriceForIva(
  deps: BillingDayDeps,
  today: string,
): Promise<{ repriced: number; failed: number }> {
  const { payments, payphoneTransactions } = schema;
  const rate = await deps.db.withSystem('billing: the IVA rate in force', ({ db: tx }) =>
    ivaRateOn(tx, today),
  );
  // Payments are the real company's (FR-ONB-6a); the join keeps it so whatever a row says.
  const stale = await deps.db.withSystem('billing: payments at an old IVA rate', ({ db: tx }) =>
    tx
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(schema.tenants, eq(schema.tenants.id, payments.tenantId))
      .where(
        and(
          isNull(schema.tenants.twinOf),
          inArray(payments.status, ['PENDING', 'REJECTED']),
          ne(payments.ivaRate, rate),
        ),
      ),
  );
  let repriced = 0;
  let failed = 0;
  for (const { id } of stale) {
    const done = await deps.db
      .withSystem('billing: charge a payment at the new IVA', async (tx) => {
        const payment = await lockPayment(tx.db, id);
        if (!['PENDING', 'REJECTED'].includes(payment.status) || new Dec(payment.ivaRate).eq(rate))
          return false;
        const [card] = await tx.db
          .select({ id: payphoneTransactions.id })
          .from(payphoneTransactions)
          .where(
            and(
              eq(payphoneTransactions.paymentId, payment.id),
              eq(payphoneTransactions.status, 'PENDING'),
            ),
          )
          .limit(1);
        if (card) return false;
        const amounts = amountsOf(new Dec(payment.baseAmount), rate);
        await tx.db
          .update(payments)
          .set({
            ivaRate: amounts.ivaRate,
            ivaAmount: amounts.ivaAmount,
            totalAmount: amounts.totalAmount,
          })
          .where(eq(payments.id, payment.id));
        await recordAudit(tx.db, {
          tenantId: payment.tenantId,
          actorUserId: null,
          action: 'payment.repriced',
          details: {
            code: payment.code,
            fromRate: payment.ivaRate,
            toRate: amounts.ivaRate,
            fromTotal: payment.totalAmount,
            toTotal: amounts.totalAmount,
          },
        });
        await notify(tx, deps, payment.tenantId, {
          template: 'paymentRepriced',
          date: today,
          amount: amounts.totalAmount,
          rate: amounts.ivaRate,
        });
        return true;
      })
      // One payment never holds back the others; the job fails at the end and runs again.
      .catch((error: unknown) => {
        failed += 1;
        deps.logger.error(`IVA re-pricing failed for a payment: ${String(error)}`, {
          event: 'billing.reprice_failed',
        });
        return false;
      });
    if (done) repriced += 1;
  }
  return { repriced, failed };
}

// The companies with a billed period, then one transaction each: one company's failure never
// holds back the others, and the job fails at the end so pg-boss runs it again.
export async function runBillingDay(deps: BillingDayDeps): Promise<BillingDayResult> {
  const tenants = await deps.db.withSystem(
    'billing: companies with a billed period',
    ({ db: tx }) =>
      tx
        .select({ tenantId: schema.subscriptions.tenantId })
        .from(schema.subscriptions)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.subscriptions.tenantId))
        .where(
          and(
            isNull(schema.tenants.twinOf),
            isNotNull(schema.subscriptions.periodEnd),
            eq(schema.subscriptions.billing, 'PAID'),
          ),
        ),
  );
  // First, so a renewal opened today is already at the new rate.
  const iva = await repriceForIva(deps, ecuadorDate(deps.clock.now()));
  const result: BillingDayResult = {
    repriced: iva.repriced,
    renewalsOpened: 0,
    graceStarted: 0,
    pastDue: 0,
    movedToFree: 0,
  };
  let failed = iva.failed;
  for (const { tenantId } of tenants) {
    try {
      const step = await runCompany(deps, tenantId);
      if (step) result[step] += 1;
    } catch (error) {
      failed += 1;
      deps.logger.error(`Billing day failed for a company: ${String(error)}`, {
        event: 'billing.daily_failed',
        tenantId,
      });
    }
  }
  deps.logger.info(
    `Billing day: ${result.repriced} repriced for IVA, ${result.renewalsOpened} renewals opened, ${result.graceStarted} in grace, ${result.pastDue} past due, ${result.movedToFree} moved to Gratis`,
    { event: 'billing.daily' },
  );
  if (failed > 0) throw new Error(`Billing day failed for ${failed} companies or payments`);
  return result;
}
