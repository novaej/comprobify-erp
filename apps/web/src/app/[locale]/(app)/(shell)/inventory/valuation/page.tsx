import { hasFeature, stockValuation } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Download, Scale } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
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
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { quantityFormat } from '../format';

export const generateMetadata = pageTitle('inventoryValuation');

// FR-INV-5: what the stock is worth at its weighted average cost, per warehouse.
export default async function ValuationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'INVENTORY')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('inventory.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const valuation = await stockValuation(actor, db);
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
  const multiple = valuation.warehouses.length > 1;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={t('valuation.title')}
        description={t('valuation.description')}
        backHref="/inventory"
        backLabel={t('product.back')}
        action={
          valuation.lines.length > 0 ? (
            // A file download, not a page: a plain link to the route.
            <a
              href={`/${locale}/inventory/valuation/csv`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              {t('valuation.download')}
            </a>
          ) : undefined
        }
      />

      <SectionCard title={t('valuation.totalsTitle')}>
        <dl className="grid gap-2 sm:grid-cols-2">
          {multiple &&
            valuation.warehouses.map((warehouse) => (
              <DetailTile
                key={warehouse.id}
                label={`${warehouse.branchCode} ${warehouse.name}`}
                value={
                  <span className="tabular-nums">
                    {money.format(warehouse.value as Intl.StringNumericLiteral)}
                  </span>
                }
                detail={t('valuation.products', { count: warehouse.products })}
              />
            ))}
          <DetailTile
            label={t('valuation.total')}
            value={
              <span className="tabular-nums">
                {money.format(valuation.total as Intl.StringNumericLiteral)}
              </span>
            }
            detail={t('valuation.products', { count: valuation.lines.length })}
          />
        </dl>
      </SectionCard>

      <section aria-labelledby="valuation-lines">
        <h2 id="valuation-lines" className="mb-3 text-sm font-semibold">
          {t('valuation.linesTitle')}
        </h2>
        <TableCard>
          {valuation.lines.length === 0 ? (
            <EmptyState
              icon={Scale}
              title={t('valuation.emptyTitle')}
              description={t('valuation.empty')}
            />
          ) : (
            <StackTable aria-labelledby="valuation-lines">
              <StackHeader>
                <StackRow className="bg-muted/40">
                  <StackHead className="pl-4">{t('table.product')}</StackHead>
                  {multiple && <StackHead>{t('table.warehouse')}</StackHead>}
                  <StackHead className="text-right">{t('table.onHand')}</StackHead>
                  <StackHead className="text-right">{t('table.averageCost')}</StackHead>
                  <StackHead className="pr-4 text-right">{t('table.value')}</StackHead>
                </StackRow>
              </StackHeader>
              <StackBody>
                {valuation.lines.map((line) => (
                  <StackRow key={`${line.productId}-${line.branchCode}`}>
                    <StackCell heading className="pl-4">
                      <Link
                        href={`/inventory/${line.productId}`}
                        className="font-medium hover:underline"
                      >
                        {line.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{line.code}</p>
                    </StackCell>
                    {multiple && (
                      <StackCell label={t('table.warehouse')}>
                        {line.branchCode} {line.warehouseName}
                      </StackCell>
                    )}
                    <StackCell label={t('table.onHand')} className="text-right tabular-nums">
                      {quantity.format(line.onHand as Intl.StringNumericLiteral)}
                      {line.unit && (
                        <span className="ml-1 text-xs text-muted-foreground">{line.unit}</span>
                      )}
                    </StackCell>
                    <StackCell label={t('table.averageCost')} className="text-right tabular-nums">
                      {cost.format(line.averageCost as Intl.StringNumericLiteral)}
                    </StackCell>
                    <StackCell label={t('table.value')} className="pr-4 text-right tabular-nums">
                      {money.format(line.value as Intl.StringNumericLiteral)}
                    </StackCell>
                  </StackRow>
                ))}
              </StackBody>
            </StackTable>
          )}
        </TableCard>
      </section>
    </div>
  );
}
