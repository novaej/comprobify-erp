import {
  hasFeature,
  listPurchaseOrders,
  PURCHASE_ORDER_STATUSES,
  purchaseOrderFilters,
  purchaseOrderNumber,
  type PurchaseOrderFilters,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { ChevronRight, ClipboardList, Plus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { OrderFilters } from './order-filters';
import { ORDER_TONE } from './order-status';

export const generateMetadata = pageTitle('purchaseOrders');

type Search = { status?: string; q?: string; page?: string };

// FR-PUR-1: every purchase order, newest first.
export default async function PurchaseOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'PURCHASE_ORDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('purchasing.read')) return <NoAccess />;

  const { db } = await getRuntime();
  // A hand-edited URL with a bad filter shows everything rather than an error.
  const parsed = purchaseOrderFilters.safeParse({
    status: search.status || undefined,
    query: search.q || undefined,
    page: search.page,
  });
  const filters: PurchaseOrderFilters = parsed.success ? parsed.data : {};
  const list = await listPurchaseOrders(actor, db, filters);
  const t = await getTranslations('purchaseOrders');
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const date = (iso: string) => iso.split('-').reverse().join('/');
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const searching = Boolean(filters.query || filters.status);
  const canManage = actor.permissions.includes('purchasing.manage');
  const pageHref = (page: number) => ({
    pathname: '/purchase-orders' as const,
    query: { ...search, page: String(page) },
  });

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          canManage && (
            <Link href="/purchase-orders/new" className={buttonVariants({ size: 'sm' })}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('new')}
            </Link>
          )
        }
      />
      <OrderFilters
        statuses={PURCHASE_ORDER_STATUSES.map((status) => ({
          value: status,
          label: t(`statuses.${status}`),
        }))}
        values={{ status: search.status, q: search.q }}
      />
      <TableCard>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={searching ? t('noMatchesTitle') : t('emptyTitle')}
            description={searching ? t('noMatches') : t('empty')}
            action={
              !searching && canManage ? (
                <Link href="/purchase-orders/new" className={buttonVariants({ size: 'sm' })}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('new')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.number')}</StackHead>
                <StackHead>{t('table.date')}</StackHead>
                <StackHead>{t('table.provider')}</StackHead>
                <StackHead>{t('table.expected')}</StackHead>
                <StackHead className="text-right">{t('table.total')}</StackHead>
                <StackHead>{t('table.status')}</StackHead>
                <StackHead className="pr-4">
                  <span className="sr-only">{t('table.open', { number: '' })}</span>
                </StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {list.rows.map((row) => {
                const number = purchaseOrderNumber(row.number);
                return (
                  <StackRow key={row.id}>
                    <StackCell heading className="pl-4">
                      <Link
                        href={`/purchase-orders/${row.id}`}
                        className="font-medium tabular-nums hover:underline"
                      >
                        {number}
                      </Link>
                    </StackCell>
                    <StackCell label={t('table.date')} className="tabular-nums">
                      {date(row.orderDate)}
                    </StackCell>
                    <StackCell label={t('table.provider')}>
                      <p className="break-words">{row.providerName}</p>
                    </StackCell>
                    <StackCell label={t('table.expected')} className="tabular-nums">
                      {row.expectedDate ? date(row.expectedDate) : '—'}
                    </StackCell>
                    <StackCell label={t('table.total')} className="text-right tabular-nums">
                      {money.format(row.total as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.status')}>
                      <ToneBadge tone={ORDER_TONE[row.status]}>
                        {t(`statuses.${row.status}`)}
                      </ToneBadge>
                    </StackCell>
                    <StackCell className="pr-4 text-right">
                      <Link
                        href={`/purchase-orders/${row.id}`}
                        aria-label={t('table.open', { number })}
                        className="inline-flex rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </StackCell>
                  </StackRow>
                );
              })}
            </StackBody>
          </StackTable>
        )}
      </TableCard>
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
    </div>
  );
}
