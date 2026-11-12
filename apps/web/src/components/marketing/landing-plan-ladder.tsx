import type { PublicPlan } from '@comprobify/core';
import { getLocale, getTranslations } from 'next-intl/server';
import { money, pick, POPULAR_PLAN } from './format';

// A spread of the plans being sold, read live; the full list is on the pricing page.
export async function LandingPlanLadder({ plans }: { plans: PublicPlan[] }) {
  const t = await getTranslations('pricing');
  const locale = await getLocale();
  if (plans.length === 0) return null;

  return (
    <ul className="mt-12 grid grid-cols-2 gap-y-8 md:grid-cols-4">
      {plans.map((plan) => {
        const free = Number(plan.monthly) === 0;
        return (
          <li key={plan.key} className="border-l border-border pl-5 md:pl-6">
            <p className="flex items-center gap-2 text-sm font-medium">
              {pick(locale, plan)}
              {plan.key === POPULAR_PLAN && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-medium text-primary">
                  {t('badge.popular')}
                </span>
              )}
            </p>
            <p className="mt-2 font-display text-3xl font-bold tracking-tight tabular-nums">
              {free ? t('free') : money(plan.monthly, locale)}
              {!free && (
                <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">
                  {t('perMonth')} {t('plusIva')}
                </span>
              )}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {plan.limits.documents === null
                ? t('compare.unlimited')
                : t('compare.perMonth', {
                    count: new Intl.NumberFormat(locale).format(plan.limits.documents),
                  })}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
