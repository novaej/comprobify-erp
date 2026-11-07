import {
  companySettings,
  hasFeature,
  ISSUABLE_DOCUMENT_TYPES,
  SRI_DOCUMENT_TYPES,
  TAX_REGIMES,
} from '@comprobify/core';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { SettingsManager } from './settings-manager';

export const generateMetadata = pageTitle('settings');

// FR-ONB-3, FR-PLAN-3: the company's tax data and where it issues from, in it and its twin.
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('organization.manage')) return <NoAccess />;

  const { db } = await getRuntime();
  const settings = await companySettings(actor, db);
  const t = await getTranslations('settings');
  const tSri = await getTranslations('sri');

  return (
    <div className="max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      <SettingsManager
        settings={{
          ...settings,
          regimes: TAX_REGIMES.map((regime) => ({ value: regime, label: t(`regimes.${regime}`) })),
          documentTypes: SRI_DOCUMENT_TYPES.map((code) => ({
            value: code,
            label: tSri(`documentTypes.${code}`),
          })),
          inventory: hasFeature(actor, 'INVENTORY'),
          offered: ISSUABLE_DOCUMENT_TYPES.filter((type) => hasFeature(actor, `DOC_TYPE_${type}`)),
        }}
      />
    </div>
  );
}
