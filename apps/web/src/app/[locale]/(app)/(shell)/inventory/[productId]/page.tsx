import { hasFeature, isDomainError, productStock, type ProductStock } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { cn } from '@comprobify/ui/lib/utils';
import { AlertTriangle, History } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { DetailTile } from '@/components/detail-tile';
import { EmptyState } from '@/components/empty-state';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge, type Tone } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { quantityFormat } from '../format';
import { StockActions } from './stock-actions';

export const generateMetadata = pageTitle('inventoryProduct');

// In green what came in, in amber what went out.
const TYPE_TONE: Record<string, Tone> = {
  OPENING_BALANCE: 'info',
  PURCHASE_RECEIPT: 'success',
  ADJUSTMENT_IN: 'success',
  RETURN_IN: 'success',
  ADJUSTMENT_OUT: 'warning',
  SALE: 'warning',
  RESERVATION: 'neutral',
  RELEASE: 'neutral',
};

// FR-INV-1, FR-INV-2: one product's stock per warehouse and every movement behind it.
export default async function ProductStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; productId: string }>;
  searchParams: Promise<{ page?: string; warehouseId?: string }>;
}) {
  const [{ locale, productId }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'INVENTORY')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('inventory.read')) return <NoAccess />;

  const { db } = await getRuntime();
  let stock: ProductStock;
  try {
    stock = await productStock(actor, db, productId, { page: Number(search.page) || 1 });
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('inventory');
  const numberLocale = locale === 'en' ? 'en' : 'es-EC';
  const money = new Intl.NumberFormat(numberLocale, { style: 'currency', currency: 'USD' });
  const cost = new Intl.NumberFormat(numberLocale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  const quantity = quantityFormat(locale);
  const when = new Intl.DateTimeFormat(numberLocale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  const unit = stock.product.unit ? ` ${stock.product.unit}` : '';
  const pages = Math.max(1, Math.ceil(stock.movementsTotal / stock.pageSize));
  const pageHref = (page: number) => ({
    pathname: `/inventory/${stock.product.id}` as const,
    query: { ...search, page: String(page) },
  });
  const multiple = stock.warehouses.length > 1;
  const negative = stock.warehouses.some((warehouse) => warehouse.onHand.startsWith('-'));

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={stock.product.name}
        description={t('product.description', { code: stock.product.code })}
        backHref="/inventory"
        backLabel={t('product.back')}
        action={
          actor.permissions.includes('inventory.adjust') && stock.product.active ? (
            <StockActions
              productId={stock.product.id}
              defaultWarehouseId={search.warehouseId}
              warehouses={stock.warehouses
                .filter((warehouse) => warehouse.active)
                .map((warehouse) => ({
                  value: warehouse.id,
                  label: `${warehouse.branchCode} ${warehouse.name}`,
                  moved: warehouse.moved,
                  averageCost: warehouse.averageCost.replace(/\.?0+$/, ''),
                }))}
            />
          ) : undefined
        }
      />
      {negative && (
        <Banner tone="warning" icon={AlertTriangle} className="mb-0">
          {t('product.negative')}
        </Banner>
      )}

      <SectionCard title={multiple ? t('product.totalTitle') : t('product.stockTitle')}>
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <DetailTile
            label={t('table.onHand')}
            value={
              <span className="tabular-nums">
                {quantity.format(stock.total.onHand as Intl.StringNumericLiteral)}
                {unit}
              </span>
            }
          />
          <DetailTile
            label={t('table.available')}
            value={
              <span className="tabular-nums">
                {quantity.format(stock.total.available as Intl.StringNumericLiteral)}
                {unit}
              </span>
            }
          />
          <DetailTile
            label={t('table.reserved')}
            value={
              <span className="tabular-nums">
                {quantity.format(stock.total.reserved as Intl.StringNumericLiteral)}
              </span>
            }
          />
          <DetailTile
            label={t('table.averageCost')}
            value={
              <span className="tabular-nums">
                {cost.format(stock.total.averageCost as Intl.StringNumericLiteral)}
              </span>
            }
          />
          <DetailTile
            label={t('table.value')}
            value={
              <span className="tabular-nums">
                {money.format(stock.total.value as Intl.StringNumericLiteral)}
              </span>
            }
          />
          <DetailTile label={t('product.rule')} value={t(`product.rules.${stock.negativeStock}`)} />
        </dl>
      </SectionCard>

      {multiple && (
        <section aria-labelledby="warehouses-title">
          <h2 id="warehouses-title" className="mb-3 text-sm font-semibold">
            {t('product.warehousesTitle')}
          </h2>
          <TableCard>
            <StackTable aria-labelledby="warehouses-title">
              <StackHeader>
                <StackRow className="bg-muted/40">
                  <StackHead className="pl-4">{t('table.warehouse')}</StackHead>
                  <StackHead className="text-right">{t('table.onHand')}</StackHead>
                  <StackHead className="text-right">{t('table.available')}</StackHead>
                  <StackHead className="text-right">{t('table.averageCost')}</StackHead>
                  <StackHead className="pr-4 text-right">{t('table.value')}</StackHead>
                </StackRow>
              </StackHeader>
              <StackBody>
                {stock.warehouses.map((warehouse) => (
                  <StackRow key={warehouse.id}>
                    <StackCell heading className="pl-4">
                      <p className="font-medium">{warehouse.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {warehouse.branchCode} {warehouse.branchName}
                      </p>
                    </StackCell>
                    <StackCell
                      label={t('table.onHand')}
                      className={cn(
                        'text-right tabular-nums',
                        warehouse.onHand.startsWith('-') && 'text-destructive',
                      )}
                    >
                      {quantity.format(warehouse.onHand as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.available')} className="text-right tabular-nums">
                      {quantity.format(warehouse.available as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.averageCost')} className="text-right tabular-nums">
                      {cost.format(warehouse.averageCost as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.value')} className="pr-4 text-right tabular-nums">
                      {money.format(warehouse.value as Intl.StringNumericLiteral)}
                    </StackCell>
                  </StackRow>
                ))}
              </StackBody>
            </StackTable>
          </TableCard>
        </section>
      )}

      <section aria-labelledby="movements-title">
        <h2 id="movements-title" className="mb-3 text-sm font-semibold">
          {t('product.movementsTitle')}
        </h2>
        <TableCard>
          {stock.movements.length === 0 ? (
            <EmptyState
              icon={History}
              title={t('product.noMovementsTitle')}
              description={t('product.noMovements')}
            />
          ) : (
            <StackTable aria-labelledby="movements-title">
              <StackHeader>
                <StackRow className="bg-muted/40">
                  <StackHead className="pl-4">{t('table.date')}</StackHead>
                  <StackHead>{t('table.type')}</StackHead>
                  {multiple && <StackHead>{t('table.warehouse')}</StackHead>}
                  <StackHead className="text-right">{t('table.quantity')}</StackHead>
                  <StackHead className="text-right">{t('table.unitCost')}</StackHead>
                  <StackHead className="text-right">{t('table.value')}</StackHead>
                  <StackHead className="pr-4">{t('table.reason')}</StackHead>
                </StackRow>
              </StackHeader>
              <StackBody>
                {stock.movements.map((movement) => (
                  <StackRow key={movement.id}>
                    <StackCell heading className="pl-4 tabular-nums">
                      {when.format(movement.createdAt)}
                    </StackCell>
                    <StackCell label={t('table.type')}>
                      <ToneBadge tone={TYPE_TONE[movement.type] ?? 'neutral'}>
                        {t(`types.${movement.type as 'SALE'}`)}
                      </ToneBadge>
                    </StackCell>
                    {multiple && (
                      <StackCell label={t('table.warehouse')}>{movement.warehouseName}</StackCell>
                    )}
                    <StackCell label={t('table.quantity')} className="text-right tabular-nums">
                      {Number(movement.quantity) === 0 && Number(movement.reserved) !== 0 ? (
                        // A reservation moves nothing on hand: show what it held or let go.
                        <span className="text-muted-foreground">
                          {t('table.reservedChange', {
                            quantity: `${movement.reserved.startsWith('-') ? '' : '+'}${quantity.format(
                              movement.reserved as Intl.StringNumericLiteral,
                            )}`,
                          })}
                        </span>
                      ) : (
                        <>
                          {movement.quantity.startsWith('-') ? '' : '+'}
                          {quantity.format(movement.quantity as Intl.StringNumericLiteral)}
                        </>
                      )}
                    </StackCell>
                    <StackCell label={t('table.unitCost')} className="text-right tabular-nums">
                      {cost.format(movement.unitCost as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.value')} className="text-right tabular-nums">
                      {money.format(movement.value as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.reason')} className="pr-4">
                      {!movement.reason &&
                      (movement.sourceType === 'DOCUMENT' ||
                        movement.sourceType === 'SALE_ORDER') &&
                      movement.sourceId ? (
                        <Link
                          href={`/${movement.sourceType === 'DOCUMENT' ? 'documents' : 'sale-orders'}/${movement.sourceId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {t(`sources.${movement.sourceType}`)}
                        </Link>
                      ) : (
                        <span className="break-words text-muted-foreground">
                          {movement.reason ??
                            (movement.sourceType
                              ? t(`sources.${movement.sourceType as 'ADJUSTMENT'}`)
                              : '—')}
                        </span>
                      )}
                    </StackCell>
                  </StackRow>
                ))}
              </StackBody>
            </StackTable>
          )}
        </TableCard>
        {pages > 1 && (
          <nav
            aria-label={t('pagination.label')}
            className="mt-4 flex items-center justify-between gap-3 text-sm"
          >
            {stock.page > 1 ? (
              <Link
                href={pageHref(stock.page - 1)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('pagination.previous')}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              {t('pagination.page', { page: stock.page, pages })}
            </span>
            {stock.page < pages ? (
              <Link
                href={pageHref(stock.page + 1)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('pagination.next')}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
