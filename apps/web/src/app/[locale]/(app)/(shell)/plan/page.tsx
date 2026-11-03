import { companyUsage, planOverview, SHOWN_LIMITS } from '@comprobify/core';
import { CheckCircle2, Clock } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('plan');

// FR-PLAN-4: what the company's plan includes and how much of each limit it uses.
// Changing plan arrives with billing (Milestone 8).
export default async function PlanPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('billing.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const [overview, usage] = await Promise.all([planOverview(actor, db), companyUsage(actor, db)]);
  const t = await getTranslations('plan');
  const english = locale === 'en';
  const name = (row: { nameEs: string; nameEn: string }) => (english ? row.nameEn : row.nameEs);
  const date = new Intl.DateTimeFormat(english ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });
  const number = new Intl.NumberFormat(english ? 'en' : 'es-EC');
  const used: Partial<Record<(typeof SHOWN_LIMITS)[number], number>> = usage;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />

      <SectionCard
        title={t('current')}
        action={
          overview.billing === 'COMPLIMENTARY' ? (
            <ToneBadge tone="primary">{t('complimentary')}</ToneBadge>
          ) : undefined
        }
      >
        <p className="text-2xl font-semibold tracking-tight">{name(overview.plan)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('changeSoon')}</p>
      </SectionCard>

      <SectionCard title={t('limitsTitle')}>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SHOWN_LIMITS.map((key) => {
            const limit = overview.limits[key];
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
    </div>
  );
}
