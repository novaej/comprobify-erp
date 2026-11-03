import { FEATURE_KEYS, FEATURES, getCatalog, MODULE_STATUS_MOVES } from '@comprobify/core';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { ModuleEditor } from '../../catalog-manager';

export const generateMetadata = pageTitle('adminModule');

// FR-ADM-3, ADR-011: one module's details and the feature keys it grants.
export default async function AdminModulePage({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const catalog = await getCatalog(actor, db);
  const found = catalog.modules.find((row) => row.key === key);
  if (!found) notFound();
  const t = await getTranslations('catalog');
  const english = locale === 'en';
  const date = new Intl.DateTimeFormat(english ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });
  const current = new Set(found.features.map((row) => row.key));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={english ? found.nameEn : found.nameEs}
        description={found.key}
        backHref="/admin/modules"
        backLabel={t('modulesPageTitle')}
      />
      <ModuleEditor
        module={{
          key: found.key,
          nameEs: found.nameEs,
          nameEn: found.nameEn,
          status: found.status,
          isBase: found.isBase,
          // The base module is always available: it is in every plan.
          statusOptions: (found.isBase
            ? ['AVAILABLE' as const]
            : MODULE_STATUS_MOVES[found.status]
          ).map((status) => ({ value: status, label: t(`statuses.${status}`) })),
          features: found.features.map((feature) => ({
            key: feature.key,
            leaves: feature.removesAt ? date.format(feature.removesAt) : null,
          })),
          addable: FEATURE_KEYS.filter(
            (featureKey) => FEATURES[featureKey] === 'BOOLEAN' && !current.has(featureKey),
          ).map((featureKey) => ({ value: featureKey, label: featureKey })),
        }}
      />
    </div>
  );
}
