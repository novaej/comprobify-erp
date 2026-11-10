import {
  billingOverview,
  companyUsage,
  getPayment,
  planOverview,
  quotaUsage,
  SHOWN_LIMITS,
} from '@comprobify/core';
import { CheckCircle2, Clock, Receipt } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge } from '@/components/tone-badge';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { pageTitle } from '@/server/page-title';
import { AddOnsSection, PacksSection, PlanSection, SeatsSection } from './billing-manager';
import { PaymentCard } from './payment-card';
import { STATUS_TONE } from '@/components/billing/payment-status';
import { PaymentLabel } from '@/components/billing/payment-label-cell';

export const generateMetadata = pageTitle('plan');

const OPEN = ['PENDING', 'REPORTED', 'REJECTED'];

// FR-PLAN-4, FR-BILL-1, FR-BILL-3, FR-BILL-5, FR-BILL-7: the company's plan and what it uses,
// what it pays and how, and what it may change. Core decides every change.
export default async function PlanPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('billing.read')) return <NoAccess />;

  const { db, payphoneDeps, bankTransfer } = await getRuntime();
  const [overview, usage, quota, billing] = await Promise.all([
    planOverview(actor, db),
    companyUsage(actor, db),
    quotaUsage(actor, db),
    billingOverview(actor, db),
  ]);
  const open = await Promise.all(
    billing.payments
      .filter((payment) => OPEN.includes(payment.status))
      .map((payment) => getPayment(actor, db, payment.id)),
  );
  const t = await getTranslations('plan');
  const english = locale === 'en';
  const name = (row: { nameEs: string; nameEn: string }) => (english ? row.nameEn : row.nameEs);
  const date = new Intl.DateTimeFormat(english ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });
  const number = new Intl.NumberFormat(english ? 'en' : 'es-EC');
  const used: Partial<Record<(typeof SHOWN_LIMITS)[number], number>> = {
    ...usage,
    DOCUMENT_QUOTA: quota.used,
  };
  // The quota shown is the period's: a yearly period holds twelve months of it.
  const limitOf = (key: (typeof SHOWN_LIMITS)[number]) =>
    key === 'DOCUMENT_QUOTA' ? quota.limit : overview.limits[key];
  const day = (iso: string) => iso.split('-').reverse().join('/');
  const billed = overview.subscription.periodEnd !== null;
  // Suspended, the company only reads (FR-BILL-9): nothing to offer it here.
  const canManage = actor.permissions.includes('billing.manage') && actor.standing !== 'SUSPENDED';
  const flags = {
    canManage,
    // Personalizado is changed by Comprobify, not from here (ADR-035).
    managed: billing.subscription.managed,
    changeOpen: open.some((payment) => payment.purpose !== 'RENEWAL'),
    unlimited: quota.limit === null,
  };
  const users = overview.limits.USERS;
  const history = billing.payments.filter((payment) => !OPEN.includes(payment.status));

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />

      {open.map((payment) => (
        <PaymentCard
          key={payment.id}
          payment={payment}
          bankTransfer={bankTransfer}
          cardAvailable={payphoneDeps !== null}
          canManage={canManage}
        />
      ))}

      <SectionCard
        title={t('current')}
        action={
          overview.billing === 'COMPLIMENTARY' ? (
            <ToneBadge tone="primary">{t('complimentary')}</ToneBadge>
          ) : overview.subscription.status === 'PAST_DUE' ? (
            <ToneBadge tone="danger">{t('pastDue')}</ToneBadge>
          ) : undefined
        }
      >
        <p className="text-2xl font-semibold tracking-tight">{name(overview.plan)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {billed
            ? t('period', {
                interval: t(`intervals.${overview.subscription.interval}`),
                start: day(overview.subscription.periodStart),
                end: day(overview.subscription.periodEnd!),
              })
            : t('notBilled')}
        </p>
        <PlanSection overview={billing} flags={flags} />
      </SectionCard>

      <SectionCard
        title={t('limitsTitle')}
        description={t('quotaWindow', { start: day(quota.start), end: day(quota.end) })}
      >
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SHOWN_LIMITS.map((key) => {
            const limit = limitOf(key);
            const value = limit === null ? t('unlimited') : number.format(limit);
            const count = used[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
              >
                <dt className="text-xs text-muted-foreground">{t(`limits.${key}`)}</dt>
                <dd className="text-xs font-medium tabular-nums">
                  {count === undefined
                    ? value
                    : t('usedOf', { used: number.format(count), limit: value })}
                </dd>
              </div>
            );
          })}
        </dl>
      </SectionCard>

      <PacksSection overview={billing} flags={flags} />
      <SeatsSection
        overview={billing}
        flags={flags}
        planUsers={users === null ? null : users - billing.subscription.extraSeats}
      />
      <AddOnsSection overview={billing} flags={flags} />

      <SectionCard title={t('modulesTitle')}>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={t('modulesTitle')}>
          {overview.modules.map((module) => {
            const soon = module.status === 'COMING_SOON';
            const Icon = soon ? Clock : CheckCircle2;
            return (
              <li
                key={module.key}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Icon
                  className={soon ? 'h-4 w-4 text-muted-foreground' : 'h-4 w-4 text-success'}
                  aria-hidden
                />
                <span className="font-medium">{name(module)}</span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {soon && <ToneBadge tone="neutral">{t('comingSoon')}</ToneBadge>}
                  {module.source === 'ADD_ON' && <ToneBadge tone="info">{t('addOn')}</ToneBadge>}
                  {module.removesAt && (
                    <ToneBadge tone="danger">
                      {t('removesAt', { date: date.format(module.removesAt) })}
                    </ToneBadge>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <section aria-labelledby="payments-title" className="space-y-3 pt-2">
        <h2 id="payments-title" className="text-sm font-semibold">
          {t('history.title')}
        </h2>
        <TableCard>
          {history.length === 0 ? (
            <EmptyState icon={Receipt} title={t('history.empty')} />
          ) : (
            <StackTable aria-label={t('history.title')}>
              <StackHeader>
                <StackRow className="bg-muted/40">
                  <StackHead className="pl-4">{t('history.what')}</StackHead>
                  <StackHead>{t('history.date')}</StackHead>
                  <StackHead>{t('history.method')}</StackHead>
                  <StackHead className="text-right">{t('history.total')}</StackHead>
                  <StackHead>{t('history.status')}</StackHead>
                </StackRow>
              </StackHeader>
              <StackBody>
                {history.map((payment) => (
                  <StackRow key={payment.id}>
                    <StackCell heading className="pl-4">
                      <PaymentLabel payment={payment} />
                      <span className="block text-xs text-muted-foreground">{payment.code}</span>
                    </StackCell>
                    <StackCell label={t('history.date')}>
                      {date.format(payment.verifiedAt ?? payment.createdAt)}
                    </StackCell>
                    <StackCell label={t('history.method')}>
                      {payment.method ? t(`history.methods.${payment.method}`) : '—'}
                    </StackCell>
                    <StackCell label={t('history.total')} className="text-right tabular-nums">
                      ${payment.totalAmount}
                    </StackCell>
                    <StackCell label={t('history.status')}>
                      <ToneBadge tone={STATUS_TONE[payment.status]}>
                        {t(`payment.status.${payment.status}`)}
                      </ToneBadge>
                    </StackCell>
                  </StackRow>
                ))}
              </StackBody>
            </StackTable>
          )}
        </TableCard>
      </section>
    </div>
  );
}
