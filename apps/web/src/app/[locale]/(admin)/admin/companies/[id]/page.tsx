import { FEATURE_KEYS, FEATURES, getCompany, isDomainError, SHOWN_LIMITS } from '@comprobify/core';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { CompanyManager } from './company-manager';

export const generateMetadata = pageTitle('adminCompany');

// FR-ADM-1, ADR-011: what one company has, and every change the operator can make.
export default async function AdminCompanyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const view = await getCompany(actor, db, id).catch((error: unknown) => {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  });
  const t = await getTranslations('admin');
  const tPlan = await getTranslations('plan');
  const tNav = await getTranslations('adminNav');
  const english = locale === 'en';
  const name = (row: { nameEs: string; nameEn: string }) => (english ? row.nameEn : row.nameEs);
  const date = new Intl.DateTimeFormat(english ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });
  const { company, plan, choices } = view;
  const added = new Set(plan.addOns.map((module) => module.key));
  const own = new Map(plan.limits.map((limit) => [limit.featureKey, limit.value]));
  const shown = (value: number | null | undefined) =>
    value === null ? t('unlimited') : String(value ?? 0);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={company.name}
        description={`${company.ruc} · ${company.legalName}`}
        backHref="/admin"
        backLabel={tNav('companies')}
      />
      <CompanyManager
        company={{
          realTenantId: company.realTenantId,
          plan: { key: plan.planKey, name: name(plan.plan), custom: plan.planKey === 'CUSTOM' },
          billing: {
            complimentary: plan.billing === 'COMPLIMENTARY',
            reason: plan.complimentaryReason,
          },
          price: plan.negotiatedMonthlyPrice,
          plans: choices.plans.map((row) => ({ value: row.key, label: name(row) })),
          modules: choices.modules
            .filter((module) => !added.has(module.key))
            .map((module) => ({ value: module.key, label: name(module) })),
          addOns: plan.addOns.map((module) => ({
            key: module.key,
            name: name(module),
            removesAt: module.removesAt ? date.format(module.removesAt) : null,
          })),
          limits: SHOWN_LIMITS.map((key) => ({
            key,
            label: tPlan(`limits.${key}`),
            resolved: shown(key in plan.entitlements.limits ? plan.entitlements.limits[key] : 0),
            own: own.has(key) ? own.get(key) : undefined,
          })),
          overrides: plan.overrides.map((override) => ({
            key: override.featureKey,
            value:
              override.effect === 'LIMIT'
                ? shown(override.limitValue)
                : t(`effects.${override.effect}`),
            reason: override.reason,
          })),
          features: FEATURE_KEYS.map((key) => ({ key, kind: FEATURES[key] })),
          active: plan.entitlements.features as string[],
        }}
      />
    </div>
  );
}
