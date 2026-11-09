import {
  canSaleOrderTransition,
  getSaleOrder,
  hasFeature,
  isDomainError,
  saleOrderNumber,
  type SaleOrderView,
} from '@comprobify/core';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { DetailTile } from '@/components/detail-tile';
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
import { ToneBadge } from '@/components/tone-badge';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { SALE_ORDER_TONE } from '../order-status';
import { OrderActions } from './order-actions';

export const generateMetadata = pageTitle('saleOrder');

// FR-SAL-1: one order, what it asks for and what it holds.
export default async function SaleOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'SALE_ORDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('sales.read')) return <NoAccess />;

  const { db } = await getRuntime();
  let order: SaleOrderView;
  try {
    order = await getSaleOrder(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('saleOrders');
  const tSri = await getTranslations('sri');
  const format = await getFormatter();
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const amount = (value: string) => money.format(value as Intl.StringNumericLiteral);
  const quantity = (value: string) => format.number(Number(value), { maximumFractionDigits: 6 });
  const date = (iso: string) => iso.split('-').reverse().join('/');
  const when = (at: Date) => format.dateTime(at, { dateStyle: 'medium', timeStyle: 'short' });
  const number = saleOrderNumber(order.number);
  const canManage = actor.permissions.includes('sales.manage');
  const allowed = {
    edit: canManage && (order.status === 'DRAFT' || order.status === 'CONFIRMED'),
    confirm: canManage && canSaleOrderTransition(order.status, 'CONFIRMED'),
    cancel: canManage && canSaleOrderTransition(order.status, 'CANCELLED'),
  };
  const discounted = order.lines.some((line) => Number(line.discount) > 0);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        className="mb-0"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">{t('detail.title', { number })}</span>
            <ToneBadge tone={SALE_ORDER_TONE[order.status]}>
              {t(`statuses.${order.status}`)}
            </ToneBadge>
          </span>
        }
        description={t(`statusHelp.${order.status}`)}
        backHref="/sale-orders"
        backLabel={t('detail.back')}
      />
      <OrderActions id={order.id} number={number} allowed={allowed} />

      <SectionCard title={t('detail.summary')}>
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <DetailTile
            label={t('detail.client')}
            value={order.client ? order.client.name : t('finalConsumer')}
          />
          {order.client && (
            <DetailTile
              label={t('detail.identification')}
              value={<span className="tabular-nums">{order.client.identification}</span>}
              detail={tSri(`idTypes.${order.client.idType as '05'}`)}
            />
          )}
          <DetailTile
            label={t('detail.warehouse')}
            value={`${order.warehouse.branchCode} ${order.warehouse.name}`}
          />
          <DetailTile
            label={t('detail.orderDate')}
            value={<span className="tabular-nums">{date(order.orderDate)}</span>}
          />
          {order.confirmedAt && (
            <DetailTile label={t('detail.confirmedAt')} value={when(order.confirmedAt)} />
          )}
          {order.cancelledAt && (
            <DetailTile label={t('detail.cancelledAt')} value={when(order.cancelledAt)} />
          )}
          {order.cancelReason && (
            <DetailTile label={t('detail.cancelReason')} value={order.cancelReason} />
          )}
        </dl>
        {order.notes && (
          <div className="mt-4 rounded-md bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">{t('detail.notes')}</p>
            <p className="text-sm break-words whitespace-pre-line">{order.notes}</p>
          </div>
        )}
      </SectionCard>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-labelledby="lines-title" className="min-w-0">
          <h2 id="lines-title" className="mb-3 text-sm font-semibold">
            {t('detail.lines.title')}
          </h2>
          <TableCard>
            <StackTable aria-labelledby="lines-title">
              <StackHeader>
                <StackRow className="bg-muted/40">
                  <StackHead className="pl-4">{t('detail.lines.product')}</StackHead>
                  <StackHead className="text-right">{t('detail.lines.quantity')}</StackHead>
                  <StackHead className="text-right">{t('detail.lines.unitPrice')}</StackHead>
                  {discounted && (
                    <StackHead className="text-right">{t('detail.lines.discount')}</StackHead>
                  )}
                  <StackHead>{t('detail.lines.iva')}</StackHead>
                  <StackHead className="pr-4 text-right">{t('detail.lines.total')}</StackHead>
                </StackRow>
              </StackHeader>
              <StackBody>
                {order.lines.map((line) => (
                  <StackRow key={line.id}>
                    <StackCell heading className="pl-4">
                      <p className="font-medium">{line.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{line.code}</p>
                    </StackCell>
                    <StackCell
                      label={t('detail.lines.quantity')}
                      className="text-right tabular-nums"
                    >
                      {quantity(line.quantity)}
                      {line.unit && (
                        <span className="ml-1 text-xs text-muted-foreground">{line.unit}</span>
                      )}
                    </StackCell>
                    <StackCell
                      label={t('detail.lines.unitPrice')}
                      className="text-right tabular-nums"
                    >
                      {format.number(Number(line.unitPrice), {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}
                    </StackCell>
                    {discounted && (
                      <StackCell
                        label={t('detail.lines.discount')}
                        className="text-right tabular-nums"
                      >
                        {amount(line.discount)}
                      </StackCell>
                    )}
                    <StackCell label={t('detail.lines.iva')}>
                      {tSri(`ivaRates.${line.ivaRateCode as '4'}`)}
                    </StackCell>
                    <StackCell
                      label={t('detail.lines.total')}
                      className="pr-4 text-right tabular-nums"
                    >
                      {amount(line.base)}
                    </StackCell>
                  </StackRow>
                ))}
              </StackBody>
            </StackTable>
          </TableCard>
        </section>

        <SectionCard title={t('detail.totals.title')}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('detail.totals.subtotal')}</dt>
              <dd className="tabular-nums">{amount(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('detail.totals.iva')}</dt>
              <dd className="tabular-nums">{amount(order.iva)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
              <dt>{t('detail.totals.total')}</dt>
              <dd className="tabular-nums">{amount(order.total)}</dd>
            </div>
          </dl>
        </SectionCard>
      </div>
    </div>
  );
}
