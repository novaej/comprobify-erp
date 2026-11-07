import {
  CARRIER_ID_TYPES,
  ecuadorDate,
  guideFromInvoice,
  guideInvoices,
  hasFeature,
  isDomainError,
  issuingOptions,
  listClients,
  listProducts,
  systemClock,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Store } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Link, redirect } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { GuideForm } from '../guide-form';

export const generateMetadata = pageTitle('newGuide');

// FR-SAL-9: a guía de remisión, from an invoice (`?from=`) or on its own.
export default async function NewGuidePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('documents.issue')) return <NoAccess />;
  if (!hasFeature(actor, 'DOC_TYPE_06')) return <FeatureLocked actor={actor} />;

  const { db } = await getRuntime();
  const t = await getTranslations('guideForm');
  const tSri = await getTranslations('sri');
  let origin: Awaited<ReturnType<typeof guideFromInvoice>> | null = null;
  if (from) {
    try {
      origin = await guideFromInvoice(actor, db, from);
    } catch (error) {
      if (
        isDomainError(error, 'ORIGIN_NOT_INVOICE') ||
        isDomainError(error, 'ORIGIN_NOT_AUTHORIZED')
      )
        return redirect({ href: `/documents/${from}`, locale });
      if (
        isDomainError(error, 'NOT_FOUND') ||
        (error instanceof Error && error.name === 'ZodError')
      )
        notFound();
      throw error;
    }
  }
  const options = await issuingOptions(actor, db, '06');
  // Pickers only for what the plan and role allow, as on the invoice form.
  const canProducts = hasFeature(actor, 'CATALOG') && actor.permissions.includes('catalog.read');
  const canClients = hasFeature(actor, 'CLIENTS') && actor.permissions.includes('clients.read');
  const [products, clients, invoices] = await Promise.all([
    canProducts ? listProducts(actor, db) : [],
    canClients ? listClients(actor, db) : [],
    origin ? [] : guideInvoices(actor, db),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={origin ? t('titleFrom', { number: origin.number }) : t('title')}
        description={t('description')}
        backHref={origin ? `/documents/${origin.originId}` : '/documents'}
        backLabel={origin ? t('backInvoice') : t('back')}
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
        <GuideForm
          issuePoints={options.issuePoints.map((point) => ({
            value: point.id,
            label: `${point.code} ${point.branchName}`,
          }))}
          carrierTypes={CARRIER_ID_TYPES.map((code) => ({
            value: code,
            label: tSri(`idTypes.${code}`),
          }))}
          today={ecuadorDate(systemClock.now())}
          originId={origin?.originId ?? null}
          originNumber={origin?.number ?? null}
          initial={origin ? { recipients: [origin.recipient] } : undefined}
          products={products.map((product) => ({
            id: product.id,
            code: product.code,
            auxiliaryCode: product.auxiliaryCode,
            name: product.name,
          }))}
          clients={clients.map((client) => ({
            id: client.id,
            identification: client.identification,
            name: client.name,
            address: client.address,
          }))}
          invoices={invoices}
        />
      )}
    </div>
  );
}
