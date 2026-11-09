import {
  getSaleOrder,
  hasFeature,
  isDomainError,
  saleOrderNumber,
  type SaleOrderView,
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
import { orderInvoiceFormData } from '../../invoice-data';
import { OrderInvoiceForm } from './order-invoice-form';

export const generateMetadata = pageTitle('invoiceSaleOrder');

// FR-SAL-3: an invoice for some or all of what a confirmed order has left.
export default async function InvoiceSaleOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'SALE_ORDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('sales.manage') || !actor.permissions.includes('documents.issue'))
    return <NoAccess />;

  const { db } = await getRuntime();
  let order: SaleOrderView;
  try {
    order = await getSaleOrder(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  // Only a confirmed order with something left is invoiced; anything else goes back to it.
  const left = order.lines.some((line) => Number(line.left) > 0);
  if (!['CONFIRMED', 'PARTIALLY_INVOICED'].includes(order.status) || !left)
    return redirect({ href: `/sale-orders/${order.id}`, locale });
  const t = await getTranslations('saleOrders');
  const number = saleOrderNumber(order.number);
  const data = await orderInvoiceFormData(
    actor,
    order.lines.map((line) => ({
      orderLineId: line.id,
      code: line.code,
      name: line.name,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discount: line.discount,
      quantity: line.quantity,
      ivaRateCode: line.ivaRateCode,
      left: line.left,
      current: '0',
    })),
  );

  return (
    <div className="max-w-7xl">
      <PageHeader
        title={t('invoice.title', { number })}
        description={t('invoice.description')}
        backHref={`/sale-orders/${order.id}`}
        backLabel={t('form.backOrder', { number })}
      />
      {data.issuePoints.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t('invoice.issuing.none')}
          action={
            actor.permissions.includes('organization.manage') ? (
              <Link href="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('invoice.issuing.noneAction')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <OrderInvoiceForm orderId={order.id} orderNumber={number} {...data} />
      )}
    </div>
  );
}
