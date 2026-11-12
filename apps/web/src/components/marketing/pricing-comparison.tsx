'use client';

import type { PublicPlan } from '@comprobify/core';
import { cn } from '@comprobify/ui/lib/utils';
import { Check, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { money, pick, POPULAR_PLAN } from './format';

// Side by side, for checking what changes between two plans: terse values, not sentences.
export function PricingComparison({
  plans,
  interval,
  number,
}: {
  plans: PublicPlan[];
  interval: 'MONTHLY' | 'YEARLY';
  number: Intl.NumberFormat;
}) {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const unlimited = t('compare.unlimited');
  const count = (value: number | null) => (value === null ? unlimited : number.format(value));
  const tint = (key: string) => (key === POPULAR_PLAN ? 'bg-primary/5' : '');

  const quota = (plan: PublicPlan) => {
    const { documents } = plan.limits;
    if (documents === null) return unlimited;
    const pooled = interval === 'YEARLY' && Number(plan.monthly) > 0;
    return t(pooled ? 'compare.perYear' : 'compare.perMonth', {
      count: number.format(pooled ? documents * 12 : documents),
    });
  };

  const rows: { label: string; cell: (plan: PublicPlan) => string }[] = [
    { label: t('compare.rows.quota'), cell: quota },
    { label: t('compare.rows.users'), cell: (plan) => count(plan.limits.users) },
    { label: t('compare.rows.branches'), cell: (plan) => count(plan.limits.branches) },
    { label: t('compare.rows.issuePoints'), cell: (plan) => count(plan.limits.issuePoints) },
  ];

  // Every module any plan includes, in the order the plans list them.
  const modules = new Map<string, { key: string; nameEs: string; nameEn: string }>();
  for (const plan of plans) for (const item of plan.modules) modules.set(item.key, item);

  return (
    <section aria-labelledby="compare-title" className="mt-20">
      <h2 id="compare-title" className="font-display text-2xl font-bold tracking-tight md:text-3xl">
        {t('compare.title')}
      </h2>
      <p className="mt-2 max-w-xl text-muted-foreground">{t('compare.subtitle')}</p>

      {/* tabIndex: a region that scrolls sideways must be reachable by keyboard. */}
      <div
        className="mt-8 overflow-x-auto rounded-xl border border-border"
        tabIndex={0}
        role="region"
        aria-labelledby="compare-title"
      >
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="sticky left-0 z-10 w-44 bg-background p-4 text-left">
                <span className="sr-only">{t('compare.feature')}</span>
              </th>
              {plans.map((plan) => {
                const free = Number(plan.monthly) === 0;
                return (
                  <th
                    key={plan.key}
                    scope="col"
                    className={cn('p-4 text-center align-bottom', tint(plan.key))}
                  >
                    <span className="block font-semibold">{pick(locale, plan)}</span>
                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground tabular-nums">
                      {free
                        ? t('free')
                        : money(interval === 'MONTHLY' ? plan.monthly : plan.yearly, locale)}
                      {!free && (interval === 'MONTHLY' ? t('perMonth') : t('perYear'))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-background p-4 text-left font-normal"
                >
                  {row.label}
                </th>
                {plans.map((plan) => (
                  <td key={plan.key} className={cn('p-4 text-center tabular-nums', tint(plan.key))}>
                    {row.cell(plan)}
                  </td>
                ))}
              </tr>
            ))}
            {[...modules.values()].map((item) => (
              <tr key={item.key} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-background p-4 text-left font-normal"
                >
                  {pick(locale, item)}
                </th>
                {plans.map((plan) => (
                  <td key={plan.key} className={cn('p-4 text-center', tint(plan.key))}>
                    {plan.modules.some((row) => row.key === item.key) ? (
                      <Check
                        className="mx-auto h-4 w-4 text-primary"
                        aria-label={t('compare.included')}
                      />
                    ) : (
                      <Minus
                        className="mx-auto h-4 w-4 text-muted-foreground"
                        aria-label={t('compare.notIncluded')}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
