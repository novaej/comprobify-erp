import {
  hasFeature,
  listStock,
  stockFilters,
  type StockFilters as Filters,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { cn } from '@comprobify/ui/lib/utils';
import { ChevronRight, Scale, Warehouse } from 'lucide-react';
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
import { ImportDialog } from './import-dialog';
import { quantityFormat } from './format';
import { StockFilters } from './stock-filters';

export const generateMetadata = pageTitle('inventory');

type Search = { warehouseId?: string; q?: string; page?: string };

// FR-INV-2, FR-INV-6: what each good that tracks stock has, in one warehouse or all.
export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'INVENTORY')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('inventory.read')) return <NoAccess />;

  const { db } = await getRuntime();
  // A hand-edited URL with a bad filter shows everything rather than an error.
  const parsed = stockFilters.safeParse({
    warehouseId: search.warehouseId || undefined,
    query: search.q || undefined,
    page: search.page,
  });
  const filters: Filters = parsed.success ? parsed.data : {};
  const list = await listStock(actor, db, filters);
  const t = await getTranslations('inventory');
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const cost = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  const quantity = quantityFormat(locale);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const searching = Boolean(filters.query || filters.warehouseId);
  const canAdjust = actor.permissions.includes('inventory.adjust');
  const activeWarehouses = list.warehouses.filter((warehouse) => warehouse.active);
  const pageHref = (page: number) => ({
    pathname: '/inventory' as const,
    query: { ...search, page: String(page) },
  });
  const productHref = (id: string) =>
    filters.warehouseId
      ? `/inventory/${id}?warehouseId=${filters.warehouseId}`
      : `/inventory/${id}`;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          <>
            <Link
              href="/inventory/valuation"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Scale className="mr-1.5 h-4 w-4" aria-hidden />
              {t('valuationLink')}
            </Link>
            {canAdjust && <ImportDialog multipleWarehouses={activeWarehouses.length > 1} />}
          </>
        }
      />
      <StockFilters
        warehouses={activeWarehouses.map((warehouse) => ({
          value: warehouse.id,
          label: `${warehouse.branchCode} ${warehouse.name}`,
        }))}
        values={{ warehouseId: search.warehouseId, q: search.q }}
      />
      <TableCard>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title={searching ? t('noMatchesTitle') : t('emptyTitle')}
            description={searching ? t('noMatches') : t('empty')}
            action={
              !searching && actor.permissions.includes('catalog.manage') ? (
                <Link href="/products" className={buttonVariants({ size: 'sm' })}>
                  {t('emptyAction')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.product')}</StackHead>
                <StackHead className="text-right">{t('table.onHand')}</StackHead>
                <StackHead className="text-right">{t('table.reserved')}</StackHead>
                <StackHead className="text-right">{t('table.available')}</StackHead>
                <StackHead className="text-right">{t('table.averageCost')}</StackHead>
                <StackHead className="text-right">{t('table.value')}</StackHead>
                <StackHead className="pr-4">
                  <span className="sr-only">{t('table.open', { name: '' })}</span>
                </StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {list.rows.map((row) => {
                const negative = row.onHand.startsWith('-');
                return (
                  <StackRow key={row.id}>
                    <StackCell heading className="pl-4">
                      <Link href={productHref(row.id)} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                      <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                        {row.code}
                        {!row.active && <ToneBadge tone="neutral">{t('inactive')}</ToneBadge>}
                      </p>
                    </StackCell>
                    <StackCell
                      label={t('table.onHand')}
                      className={cn('text-right tabular-nums', negative && 'text-destructive')}
                    >
                      {quantity.format(row.onHand as Intl.StringNumericLiteral)}
                      {row.unit && (
                        <span className="ml-1 text-xs text-muted-foreground">{row.unit}</span>
                      )}
                    </StackCell>
                    <StackCell label={t('table.reserved')} className="text-right tabular-nums">
                      {quantity.format(row.reserved as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.available')} className="text-right tabular-nums">
                      {quantity.format(row.available as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.averageCost')} className="text-right tabular-nums">
                      {cost.format(row.averageCost as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.value')} className="text-right tabular-nums">
                      {money.format(row.value as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell className="pr-4 text-right">
                      <Link
                        href={productHref(row.id)}
                        aria-label={t('table.open', { name: row.name })}
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
