import {
  hasFeature,
  issuingOptions,
  listInvoiceableOrders,
  saleOrderNumber,
  SRI_PAYMENT_METHODS,
  SRI_TERM_UNITS,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Button } from '@comprobify/ui/components/button';
import { Search, Store } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { BatchForm } from './batch-form';

export const generateMetadata = pageTitle('newBulkBatch');

// FR-BULK-1: pick confirmed sale orders, or take all that match, and how they are paid.
export default async function NewBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'BULK_INVOICING') || !hasFeature(actor, 'SALE_ORDERS'))
    return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('sales.manage') || !actor.permissions.includes('documents.issue'))
    return <NoAccess />;

  const { db } = await getRuntime();
  const page = Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1);
  const [list, options, t, tSri] = await Promise.all([
    listInvoiceableOrders(actor, db, { query: search.q || undefined, page }),
    issuingOptions(actor, db),
    getTranslations('bulkInvoicing'),
    getTranslations('sri'),
  ]);
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const date = (iso: string) => iso.split('-').reverse().join('/');
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const pageHref = (target: number) => ({
    pathname: '/bulk-invoicing/new' as const,
    query: { ...(search.q ? { q: search.q } : {}), page: String(target) },
  });

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('new')}
        description={t('newDescription')}
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
        <>
          <form role="search" className="mb-4 flex max-w-md gap-2">
            <Input
              name="q"
              type="search"
              defaultValue={search.q ?? ''}
              aria-label={t('search')}
              placeholder={t('search')}
            />
            <Button type="submit" variant="outline">
              <Search className="mr-1.5 h-4 w-4" aria-hidden />
              {t('searchButton')}
            </Button>
          </form>
          <BatchForm
            // A new search or page starts a new selection.
            key={`${search.q ?? ''}:${page}`}
            orders={list.rows.map((row) => ({
              id: row.id,
              number: saleOrderNumber(row.number),
              date: date(row.orderDate),
              client: row.clientName ?? t('finalConsumer'),
              total: money.format(row.total as Intl.StringNumericLiteral),
            }))}
            matching={list.total}
            query={search.q ?? ''}
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
          {pages > 1 && (
            <nav
              aria-label={t('pagination.label')}
              className="mt-4 flex items-center justify-between gap-3 text-sm"
            >
              {list.page > 1 ? (
                <Link
                  href={pageHref(list.page - 1)}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('pagination.previous')}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                {t('pagination.page', { page: list.page, pages })}
              </span>
              {list.page < pages ? (
                <Link
                  href={pageHref(list.page + 1)}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('pagination.next')}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
