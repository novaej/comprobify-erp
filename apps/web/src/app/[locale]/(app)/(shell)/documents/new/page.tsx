import {
  ecuadorDate,
  hasFeature,
  issuingOptions,
  listClients,
  listProducts,
  SRI_PAYMENT_METHODS,
  SRI_TERM_UNITS,
  systemClock,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Store } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { InvoiceForm } from './invoice-form';

export const generateMetadata = pageTitle('newInvoice');

// FR-DOC-2, FR-UX-4: a factura, line by line from the keyboard.
export default async function NewInvoicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('documents.issue')) return <NoAccess />;

  const { db, env } = await getRuntime();
  const options = await issuingOptions(actor, db);
  // Pickers only for what the plan and role allow; free-text lines and consumidor final
  // need neither.
  const canProducts = hasFeature(actor, 'CATALOG') && actor.permissions.includes('catalog.read');
  const canClients = hasFeature(actor, 'CLIENTS') && actor.permissions.includes('clients.read');
  const [products, clients] = await Promise.all([
    canProducts ? listProducts(actor, db) : [],
    canClients ? listClients(actor, db) : [],
  ]);
  const t = await getTranslations('invoiceForm');
  const tSri = await getTranslations('sri');
  const [year, month, day] = ecuadorDate(systemClock.now()).split('-');

  return (
    <div className="max-w-7xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        backHref="/documents"
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
        <InvoiceForm
          issuePoints={options.issuePoints.map((point) => ({
            value: point.id,
            label: `${point.code} ${point.branchName}`,
          }))}
          ivaRates={options.ivaRates.map((rate) => ({
            value: rate.code,
            percent: rate.percent,
            label: tSri(`ivaRates.${rate.code as '4'}`),
          }))}
          defaultIvaRate={
            options.ivaRates.some((rate) => rate.code === '4')
              ? '4'
              : (options.ivaRates[0]?.code ?? '0')
          }
          products={products.map((product) => ({
            id: product.id,
            code: product.code,
            auxiliaryCode: product.auxiliaryCode,
            name: product.name,
            unit: product.unit,
            price: product.price,
            ivaRateCode: product.ivaRateCode,
          }))}
          clients={clients.map((client) => ({
            id: client.id,
            idTypeLabel: tSri(`idTypes.${client.idType as '04'}`),
            identification: client.identification,
            name: client.name,
            email: client.emails[0] ?? null,
          }))}
          paymentMethods={SRI_PAYMENT_METHODS.map((code) => ({
            value: code,
            label: tSri(`paymentMethods.${code}`),
          }))}
          termUnits={SRI_TERM_UNITS.map((code) => ({
            value: code,
            label: tSri(`termUnits.${code}`),
          }))}
          consumerFinalMax={env.CONSUMER_FINAL_MAX_AMOUNT}
          today={`${day}/${month}/${year}`}
        />
      )}
    </div>
  );
}
