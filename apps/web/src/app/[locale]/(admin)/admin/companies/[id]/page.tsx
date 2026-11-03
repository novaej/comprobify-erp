import { FEATURE_KEYS, FEATURES, getCompany, isDomainError, SHOWN_LIMITS } from '@comprobify/core';
import { Badge } from '@comprobify/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@comprobify/ui/components/card';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import {
  AddModuleForm,
  BillingForm,
  ClearOverrideForm,
  LimitForm,
  ModuleRowForm,
  OverrideForm,
  PlanForm,
  PriceForm,
} from './forms';

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
  const english = locale === 'en';
  const name = (row: { nameEs: string; nameEn: string }) => (english ? row.nameEn : row.nameEs);
  const date = new Intl.DateTimeFormat(english ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });
  const { company, plan, choices } = view;
  const realTenantId = company.realTenantId;
  const custom = plan.planKey === 'CUSTOM';
  const added = new Set(plan.addOns.map((module) => module.key));
  const limitItem = new Map(plan.limits.map((limit) => [limit.featureKey, limit.value]));
  const resolved = (key: string) => {
    const value = key in plan.entitlements.limits ? plan.entitlements.limits[key] : 0;
    return value === null ? t('unlimited') : String(value);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          {t('backToCompanies')}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{company.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          {company.ruc} · {company.legalName}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>{tPlan('current')}</CardDescription>
          <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
            {name(plan.plan)}
            {plan.billing === 'COMPLIMENTARY' && (
              <Badge variant="secondary">{t('complimentary')}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <PlanForm
            realTenantId={realTenantId}
            current={plan.planKey}
            plans={choices.plans.map((row) => ({ key: row.key, label: name(row) }))}
          />
          <BillingForm
            realTenantId={realTenantId}
            complimentary={plan.billing === 'COMPLIMENTARY'}
            reason={plan.complimentaryReason}
          />
          {custom && <PriceForm realTenantId={realTenantId} price={plan.negotiatedMonthlyPrice} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('addOnsTitle')}</CardTitle>
          <CardDescription>{t('addOnsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {plan.addOns.length > 0 && (
            <ul className="divide-y divide-border" aria-label={t('addOnsTitle')}>
              {plan.addOns.map((module) => (
                <li
                  key={module.key}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{name(module)}</span>
                    {module.removesAt && (
                      <Badge variant="destructive">
                        {tPlan('removesAt', { date: date.format(module.removesAt) })}
                      </Badge>
                    )}
                  </span>
                  <ModuleRowForm
                    realTenantId={realTenantId}
                    moduleKey={module.key}
                    scheduled={module.removesAt !== null}
                    name={name(module)}
                  />
                </li>
              ))}
            </ul>
          )}
          <AddModuleForm
            realTenantId={realTenantId}
            modules={choices.modules
              .filter((module) => !added.has(module.key))
              .map((module) => ({ key: module.key, label: name(module) }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('limitsTitle')}</CardTitle>
          <CardDescription>{custom ? t('limitsCustom') : t('limitsPlan')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border text-sm">
            {SHOWN_LIMITS.map((key) => (
              <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">
                  {tPlan(`limits.${key}`)}:{' '}
                  <span className="font-medium text-foreground">{resolved(key)}</span>
                </dt>
                {custom && (
                  <dd>
                    <LimitForm
                      realTenantId={realTenantId}
                      featureKey={key}
                      label={tPlan(`limits.${key}`)}
                      value={limitItem.get(key)}
                      isSet={limitItem.has(key)}
                    />
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('overridesTitle')}</CardTitle>
          <CardDescription>{t('overridesDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plan.overrides.length > 0 && (
            <ul className="divide-y divide-border" aria-label={t('overridesTitle')}>
              {plan.overrides.map((override) => (
                <li
                  key={override.featureKey}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    <span className="font-mono font-medium">{override.featureKey}</span>{' '}
                    <Badge variant="outline">
                      {override.effect === 'LIMIT'
                        ? override.limitValue === null
                          ? t('unlimited')
                          : String(override.limitValue)
                        : t(`effects.${override.effect}`)}
                    </Badge>
                    <span className="ml-2 text-muted-foreground">{override.reason}</span>
                  </span>
                  <ClearOverrideForm realTenantId={realTenantId} featureKey={override.featureKey} />
                </li>
              ))}
            </ul>
          )}
          <OverrideForm
            realTenantId={realTenantId}
            features={FEATURE_KEYS.map((key) => ({ key, kind: FEATURES[key] }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('resolvedTitle')}</CardTitle>
          <CardDescription>{t('resolvedDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-xs leading-relaxed break-words text-muted-foreground">
            {plan.entitlements.features.join(' · ')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
