import {
  certificateStatus,
  companySettings,
  hasFeature,
  limitOf,
  companySequentials,
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
  const sequentials = await companySequentials(actor, db);
  const certificate = await certificateStatus(db, actor);
  const t = await getTranslations('settings');
  const tSri = await getTranslations('sri');

  return (
    <div className="max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      <SettingsManager
        settings={{
          ...settings,
          sequentials,
          testMode: actor.tenantMode !== 'PRODUCTION',
          canResetTwin: actor.permissions.includes('organization.reset_twin'),
          regimes: TAX_REGIMES.map((regime) => ({ value: regime, label: t(`regimes.${regime}`) })),
          documentTypes: SRI_DOCUMENT_TYPES.map((code) => ({
            value: code,
            label: tSri(`documentTypes.${code}`),
          })),
          inventory: hasFeature(actor, 'INVENTORY'),
          logoPrints: hasFeature(actor, 'RIDE_LOGO'),
          certificate: {
            state: certificate.state,
            date:
              'notAfter' in certificate
                ? new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
                    dateStyle: 'long',
                    timeZone: 'America/Guayaquil',
                  }).format(certificate.notAfter)
                : null,
            days: 'daysLeft' in certificate ? certificate.daysLeft : null,
          },
          // Null is unlimited. The buttons are disabled at the limit, as in Usuarios.
          maxBranches: limitOf(actor.entitlements, 'MAX_BRANCHES'),
          maxPoints: limitOf(actor.entitlements, 'MAX_ISSUE_POINTS_PER_BRANCH'),
          canSeePlan: actor.permissions.includes('billing.read'),
          offered: ISSUABLE_DOCUMENT_TYPES.filter((type) => hasFeature(actor, `DOC_TYPE_${type}`)),
          typesLocked: ISSUABLE_DOCUMENT_TYPES.some(
            (type) => !hasFeature(actor, `DOC_TYPE_${type}`),
          ),
        }}
      />
    </div>
  );
}
