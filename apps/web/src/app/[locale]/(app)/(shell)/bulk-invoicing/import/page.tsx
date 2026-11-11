import { hasFeature, issuingOptions, SRI_PAYMENT_METHODS, SRI_TERM_UNITS } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Store } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { CsvBatchForm } from './csv-batch-form';

export const generateMetadata = pageTitle('importBulkBatch');

// FR-BULK-1: a CSV of invoice lines, one invoice per reference, on any plan with Bulk invoicing.
// It needs no Sales module: the file names the products and clients itself.
export default async function ImportBatchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'BULK_INVOICING') || !hasFeature(actor, 'CATALOG'))
    return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('documents.issue')) return <NoAccess />;

  const { db } = await getRuntime();
  const [options, t, tSri] = await Promise.all([
    issuingOptions(actor, db),
    getTranslations('bulkInvoicing'),
    getTranslations('sri'),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t('csv.title')}
        description={t('csv.description')}
        backHref="/bulk-invoicing"
        backLabel={t('back')}
      />
      {options.issuePoints.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t('issuing.none')}
          action={
            actor.permissions.includes('organization.manage') ? (
              <Link href="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('issuing.noneAction')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <CsvBatchForm
          issuePoints={options.issuePoints.map((point) => ({
            value: point.id,
            label: `${point.code} ${point.branchName}`,
          }))}
          paymentMethods={SRI_PAYMENT_METHODS.map((code) => ({
            value: code,
            label: tSri(`paymentMethods.${code}`),
          }))}
          termUnits={SRI_TERM_UNITS.map((code) => ({
            value: code,
            label: tSri(`termUnits.${code}`),
          }))}
        />
      )}
    </div>
  );
}
