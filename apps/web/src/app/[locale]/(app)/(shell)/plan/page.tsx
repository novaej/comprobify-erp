import { companyUsage, planOverview, SHOWN_LIMITS } from '@comprobify/core';
import { Badge } from '@comprobify/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@comprobify/ui/components/card';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

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
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>{t('current')}</CardDescription>
          <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
            {name(overview.plan)}
            {overview.billing === 'COMPLIMENTARY' && (
              <Badge variant="secondary">{t('complimentary')}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('changeSoon')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('modulesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" aria-label={t('modulesTitle')}>
            {overview.modules.map((module) => (
              <li
                key={module.key}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
              >
                <span className="font-medium">{name(module)}</span>
                <span className="flex flex-wrap gap-1.5">
                  {module.status === 'COMING_SOON' && (
                    <Badge variant="outline">{t('comingSoon')}</Badge>
                  )}
                  {module.source === 'ADD_ON' && <Badge variant="secondary">{t('addOn')}</Badge>}
                  {module.removesAt && (
                    <Badge variant="destructive">
                      {t('removesAt', { date: date.format(module.removesAt) })}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('limitsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border text-sm">
            {SHOWN_LIMITS.map((key) => {
              const limit = overview.limits[key];
              const value = limit === null ? t('unlimited') : number.format(limit);
              const count = used[key];
              return (
                <div key={key} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-muted-foreground">{t(`limits.${key}`)}</dt>
                  <dd className="font-medium tabular-nums">
                    {count === undefined
                      ? value
                      : t('usedOf', { used: number.format(count), limit: value })}
                  </dd>
                </div>
              );
            })}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
