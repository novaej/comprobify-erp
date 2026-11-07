import {
  canPurchaseOrderTransition,
  getPurchaseOrder,
  hasFeature,
  isDomainError,
  purchaseOrderNumber,
  type PurchaseOrderView,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { FileText } from 'lucide-react';
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
import { ORDER_TONE } from '../order-status';
import { OrderActions } from './order-actions';

export const generateMetadata = pageTitle('purchaseOrder');

// FR-PUR-1: one order, what it asks for and how much has arrived.
export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'PURCHASE_ORDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('purchasing.read')) return <NoAccess />;

  const { db } = await getRuntime();
  let order: PurchaseOrderView;
  try {
    order = await getPurchaseOrder(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('purchaseOrders');
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
  const number = purchaseOrderNumber(order.number);
  const canManage = actor.permissions.includes('purchasing.manage');
  const allowed = {
    edit: canManage && order.status === 'DRAFT',
    send: canManage && canPurchaseOrderTransition(order.status, 'SENT'),
    email:
      canManage &&
      (order.status === 'DRAFT' ||
        order.status === 'SENT' ||
        order.status === 'PARTIALLY_RECEIVED'),
    receive: canManage && (order.status === 'SENT' || order.status === 'PARTIALLY_RECEIVED'),
    cancel: canManage && canPurchaseOrderTransition(order.status, 'CANCELLED'),
    close: canManage && canPurchaseOrderTransition(order.status, 'CLOSED'),
  };
  const receivedAny = order.receipts.length > 0;
  const lineById = new Map(order.lines.map((line) => [line.id, line]));

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        className="mb-0"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">{t('detail.title', { number })}</span>
            <ToneBadge tone={ORDER_TONE[order.status]}>{t(`statuses.${order.status}`)}</ToneBadge>
          </span>
        }
        description={t(`statusHelp.${order.status}`)}
        backHref="/purchase-orders"
        backLabel={t('detail.back')}
        action={
          <a
            href={`/${locale}/purchase-orders/${order.id}/pdf`}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <FileText className="mr-1.5 h-4 w-4" aria-hidden />
            {t('detail.pdf')}
          </a>
        }
      />
      <OrderActions
        id={order.id}
        number={number}
        allowed={allowed}
        short={order.status === 'PARTIALLY_RECEIVED'}
        providerEmails={order.provider.emails}
        draft={order.status === 'DRAFT'}
      />

      <SectionCard title={t('detail.summary')}>
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <DetailTile label={t('detail.provider')} value={order.provider.name} />
          <DetailTile
            label={t('detail.identification')}
            value={<span className="tabular-nums">{order.provider.identification}</span>}
            detail={tSri(`idTypes.${order.provider.idType as '04'}`)}
          />
          {order.provider.emails.length > 0 && (
            <DetailTile
              label={t('detail.email')}
              value={<span className="break-all">{order.provider.emails.join(', ')}</span>}
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
          {order.expectedDate && (
            <DetailTile
              label={t('detail.expectedDate')}
              value={<span className="tabular-nums">{date(order.expectedDate)}</span>}
            />
          )}
          {order.sentAt && <DetailTile label={t('detail.sentAt')} value={when(order.sentAt)} />}
          {order.emailedAt && order.emailedTo && (
            <DetailTile
              label={t('detail.emailedAt')}
              value={<span className="break-all">{order.emailedTo.join(', ')}</span>}
              detail={when(order.emailedAt)}
            />
          )}
          {order.closedAt && (
            <DetailTile label={t('detail.closedAt')} value={when(order.closedAt)} />
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
                  {receivedAny && (
                    <StackHead className="text-right">{t('detail.lines.received')}</StackHead>
                  )}
                  <StackHead className="text-right">{t('detail.lines.unitCost')}</StackHead>
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
                    {receivedAny && (
                      <StackCell
                        label={t('detail.lines.received')}
                        className="text-right tabular-nums"
                      >
                        {quantity(line.receivedQuantity)}
                      </StackCell>
                    )}
                    <StackCell
                      label={t('detail.lines.unitCost')}
                      className="text-right tabular-nums"
                    >
                      {format.number(Number(line.unitCost), {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}
                    </StackCell>
                    <StackCell label={t('detail.lines.iva')}>
                      {tSri(`ivaRates.${line.ivaRateCode as '4'}`)}
                    </StackCell>
                    <StackCell
                      label={t('detail.lines.total')}
                      className="pr-4 text-right tabular-nums"
                    >
                      {amount(line.subtotal)}
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

      {order.status !== 'DRAFT' && order.status !== 'CANCELLED' && (
        <SectionCard title={t('detail.receipts.title')}>
          {order.receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detail.receipts.empty')}</p>
          ) : (
            <ol className="space-y-4">
              {order.receipts.map((receipt) => (
                <li key={receipt.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <p className="text-sm font-medium">
                    {t('detail.receipts.receipt', { date: date(receipt.receivedDate) })}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {when(receipt.createdAt)}
                    </span>
                  </p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {receipt.lines.map((item) => {
                      const line = lineById.get(item.orderLineId);
                      return (
                        <li
                          key={item.orderLineId}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1"
                        >
                          <span className="tabular-nums">{quantity(item.quantity)}</span>
                          {line?.unit && (
                            <span className="text-xs text-muted-foreground">{line.unit}</span>
                          )}
                          <span>{line?.name}</span>
                          {!item.moved && (
                            <ToneBadge tone="neutral">{t('detail.receipts.noMovement')}</ToneBadge>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {receipt.notes && (
                    <p className="mt-1 text-xs break-words text-muted-foreground">
                      {receipt.notes}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      )}
    </div>
  );
}
