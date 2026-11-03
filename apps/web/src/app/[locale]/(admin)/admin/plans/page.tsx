import { getCatalog } from '@comprobify/core';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
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
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { NewPlanButton } from '../catalog-manager';
import { STATUS_TONE } from '../catalog-tones';

export const generateMetadata = pageTitle('adminPlans');

// FR-ADM-3: every plan, in the order customers see them.
export default async function AdminPlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const catalog = await getCatalog(actor, db);
  const t = await getTranslations('catalog');
  const english = locale === 'en';
  const moduleName = new Map(
    catalog.modules.map((module) => [module.key, english ? module.nameEn : module.nameEs]),
  );

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('plansTitle')}
        description={t('plansDescription')}
        action={<NewPlanButton />}
      />
      <TableCard>
        <StackTable aria-label={t('plansTitle')}>
          <StackHeader>
            <StackRow className="bg-muted/40">
              <StackHead className="pl-4">{t('table.plan')}</StackHead>
              <StackHead>{t('table.modules')}</StackHead>
              <StackHead className="pr-4">{t('table.status')}</StackHead>
            </StackRow>
          </StackHeader>
          <StackBody>
            {catalog.plans.map((plan) => (
              <StackRow key={plan.key}>
                <StackCell heading className="pl-4">
                  <Link
                    href={`/admin/plans/${plan.key}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {english ? plan.nameEn : plan.nameEs}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{plan.key}</p>
                </StackCell>
                <StackCell label={t('table.modules')} className="whitespace-normal">
                  <span className="text-sm text-muted-foreground">
                    {plan.modules
                      .filter((module) => !module.removesAt)
                      .map((module) => moduleName.get(module.key))
                      .join(', ')}
                  </span>
                </StackCell>
                <StackCell label={t('table.status')} className="pr-4">
                  <span className="flex flex-wrap gap-1.5">
                    <ToneBadge tone={STATUS_TONE[plan.status] ?? 'neutral'}>
                      {t(`statuses.${plan.status}`)}
                    </ToneBadge>
                    {!plan.selfService && <ToneBadge tone="info">{t('operatorOnly')}</ToneBadge>}
                  </span>
                </StackCell>
              </StackRow>
            ))}
          </StackBody>
        </StackTable>
      </TableCard>
    </div>
  );
}
