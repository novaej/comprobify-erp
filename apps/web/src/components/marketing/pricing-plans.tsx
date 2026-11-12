'use client';

import type { PublicPlan, PublicPricing } from '@comprobify/core';
import { Badge } from '@comprobify/ui/components/badge';
import { cn } from '@comprobify/ui/lib/utils';
import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ctaVariants } from './cta-button';
import { money, pick, POPULAR_PLAN } from './format';
import { PricingComparison } from './pricing-comparison';

type Interval = 'MONTHLY' | 'YEARLY';

const TOGGLE =
  'rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5';

// Plans and prices come from the database (FR-UX-5), so an edit in the platform area reaches this
// page with no release. Prices are before IVA; yearly is twelve months for ten (FR-BILL-1).
export function PricingPlans({ pricing }: { pricing: PublicPricing }) {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const [interval, setInterval] = useState<Interval>('MONTHLY');
  const number = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-EC');
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-EC', {
    dateStyle: 'long',
    timeZone: 'UTC',
  });
  const { plans } = pricing;

  const limitLine = (plan: PublicPlan) => {
    const { documents, users, branches, issuePoints } = plan.limits;
    // A yearly plan holds its whole year's documents up front (ADR-028).
    const quota =
      documents === null
        ? t('features.unlimitedQuota')
        : interval === 'YEARLY' && Number(plan.monthly) > 0
          ? t('features.quotaYearly', { count: documents * 12 })
          : t('features.quota', { count: documents });
    return [
      quota,
      users === null ? t('features.unlimitedUsers') : t('features.users', { count: users }),
      branches === null
        ? t('features.unlimitedBranches')
        : t('features.branches', { count: branches }),
      issuePoints === null
        ? t('features.unlimitedIssuePoints')
        : t('features.issuePoints', { count: issuePoints }),
    ];
  };

  return (
    <div>
      <div className="mb-8 flex justify-center">
        <div
          role="group"
          aria-label={t('interval.label')}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1"
        >
          <button
            type="button"
            aria-pressed={interval === 'MONTHLY'}
            onClick={() => setInterval('MONTHLY')}
            className={cn(
              TOGGLE,
              interval === 'MONTHLY'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-foreground/75',
            )}
          >
            {t('interval.monthly')}
          </button>
          <button
            type="button"
            aria-pressed={interval === 'YEARLY'}
            onClick={() => setInterval('YEARLY')}
            className={cn(
              TOGGLE,
              interval === 'YEARLY'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-foreground/75',
            )}
          >
            {t('interval.yearly')}
            <Badge variant="secondary" className="text-2xs">
              {t('interval.yearlyDiscount')}
            </Badge>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const popular = plan.key === POPULAR_PLAN;
          const free = Number(plan.monthly) === 0;
          // A free plan costs nothing either way, so it shows no interval.
          const price = interval === 'MONTHLY' || free ? plan.monthly : plan.yearly;
          return (
            <div
              key={plan.key}
              className={cn(
                'flex flex-col gap-5 rounded-lg border p-6',
                popular && 'border-primary ring-1 ring-primary',
              )}
            >
              {popular && (
                <span className="text-xs font-semibold text-primary">{t('badge.popular')}</span>
              )}
              <div>
                <h2 className="text-lg font-semibold">{pick(locale, plan)}</h2>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <p className="text-3xl font-bold">
                    {free ? '$0' : money(price, locale)}
                    {!free && (
                      <span className="text-sm font-normal text-muted-foreground">
                        {interval === 'MONTHLY' ? t('perMonth') : t('perYear')}
                      </span>
                    )}
                  </p>
                  {!free && (
                    <Badge variant="outline" className="text-2xs font-normal text-muted-foreground">
                      {t('plusIva')}
                    </Badge>
                  )}
                </div>
                {!free && interval === 'YEARLY' && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('yearlyEquivalent', {
                      price: money((Number(plan.yearly) / 12).toFixed(2), locale),
                    })}
                  </p>
                )}
                {plan.upcoming && (
                  <p className="mt-2 text-xs text-warning">
                    {t('upcomingPriceNote', {
                      price: money(plan.upcoming.monthly, locale),
                      date: date.format(new Date(`${plan.upcoming.on}T00:00:00Z`)),
                    })}
                  </p>
                )}
              </div>

              <ul className="flex flex-1 flex-col gap-2 text-sm">
                {limitLine(plan).map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    {line}
                  </li>
                ))}
                {plan.modules.map((item) => (
                  <li key={item.key} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    {pick(locale, item)}
                  </li>
                ))}
              </ul>

              <Link
                href="/register"
                className={cn(
                  ctaVariants(popular ? 'default' : 'outline'),
                  'w-full justify-center',
                )}
              >
                {free ? t('ctaFree') : t('cta')}
              </Link>
            </div>
          );
        })}
      </div>

      {pricing.seatMonthly && (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          {t('extraSeatNote', {
            price: money(
              interval === 'MONTHLY'
                ? pricing.seatMonthly
                : (Number(pricing.seatMonthly) * 10).toFixed(2),
              locale,
            ),
          })}
          {interval === 'MONTHLY' ? t('perMonth') : t('perYear')} {t('plusIva')}
        </p>
      )}
      <p className="mt-2 text-center text-sm text-muted-foreground">{t('paymentMethodsNote')}</p>

      {pricing.addOns.length > 0 && (
        <section aria-labelledby="addons-title" className="mt-20">
          <h2
            id="addons-title"
            className="font-display text-2xl font-bold tracking-tight md:text-3xl"
          >
            {t('addOns.title')}
          </h2>
          <p className="mt-2 max-w-xl text-muted-foreground">{t('addOns.subtitle')}</p>
          <ul className="mt-8 grid gap-x-10 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {pricing.addOns.map((addOn) => (
              <li
                key={addOn.key}
                className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-sm"
              >
                <span>{pick(locale, addOn)}</span>
                <span className="tabular-nums">
                  {money(
                    interval === 'MONTHLY'
                      ? addOn.monthly
                      : (Number(addOn.monthly) * 10).toFixed(2),
                    locale,
                  )}
                  <span className="text-muted-foreground">
                    {interval === 'MONTHLY' ? t('perMonth') : t('perYear')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PricingComparison plans={plans} interval={interval} number={number} />
    </div>
  );
}
