import { getCatalog, PLAN_STATUS_MOVES, SHOWN_LIMITS } from '@comprobify/core';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { PlanEditor } from '../../catalog-manager';

export const generateMetadata = pageTitle('adminPlan');

// FR-ADM-3, ADR-011: one plan's details, modules and limits.
export default async function AdminPlanPage({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const catalog = await getCatalog(actor, db);
  const plan = catalog.plans.find((row) => row.key === key);
  if (!plan) notFound();
  const t = await getTranslations('catalog');
  const tPlan = await getTranslations('plan');
  const tCommon = await getTranslations('common');
  const english = locale === 'en';
  const name = (row: { nameEs: string; nameEn: string }) => (english ? row.nameEn : row.nameEs);
  const date = new Intl.DateTimeFormat(english ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });
  const shown = (value: number | null | undefined) =>
    value === null ? tCommon('unlimited') : String(value ?? 0);
  // A removed module is still listed, with its undo, so it isn't offered again here.
  const linked = new Set(plan.modules.map((row) => row.key));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={name(plan)}
        description={plan.key}
        backHref="/admin/plans"
        backLabel={t('plansTitle')}
      />
      <PlanEditor
        plan={{
          key: plan.key,
          nameEs: plan.nameEs,
          nameEn: plan.nameEn,
          status: plan.status,
          selfService: plan.selfService,
          statusOptions: PLAN_STATUS_MOVES[plan.status].map((status) => ({
            value: status,
            label: t(`statuses.${status}`),
          })),
          modules: plan.modules.map((link) => {
            const found = catalog.modules.find((row) => row.key === link.key)!;
            return {
              key: link.key,
              name: name(found),
              isBase: found.isBase,
              comingSoon: found.status === 'COMING_SOON',
              leaves: link.removesAt ? date.format(link.removesAt) : null,
            };
          }),
          addable: catalog.modules
            .filter((module) => !linked.has(module.key) && !module.isBase)
            .map((module) => ({ value: module.key, label: name(module) })),
          limits: SHOWN_LIMITS.map((limitKey) => {
            const row = plan.limits.find((limit) => limit.key === limitKey);
            return {
              key: limitKey,
              label: tPlan(`limits.${limitKey}`),
              value: shown(row ? row.value : 0),
              raw: row ? row.value : 0,
              pending:
                row?.pendingFrom && row.pendingValue !== null
                  ? t('pendingLimit', {
                      value: shown(row.pendingValue),
                      date: date.format(row.pendingFrom),
                    })
                  : null,
            };
          }),
        }}
      />
    </div>
  );
}
