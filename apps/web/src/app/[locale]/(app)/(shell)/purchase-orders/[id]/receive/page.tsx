import {
  getPurchaseOrder,
  hasFeature,
  isDomainError,
  purchaseOrderNumber,
  type PurchaseOrderView,
} from '@comprobify/core';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { redirect } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { ReceiveForm } from './receive-form';

export const generateMetadata = pageTitle('receivePurchaseOrder');

// FR-PUR-2: only a sent or partly received order receives goods.
export default async function ReceivePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'PURCHASE_ORDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('purchasing.manage')) return <NoAccess />;

  const { db } = await getRuntime();
  let order: PurchaseOrderView;
  try {
    order = await getPurchaseOrder(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  if (order.status !== 'SENT' && order.status !== 'PARTIALLY_RECEIVED')
    return redirect({ href: `/purchase-orders/${order.id}`, locale });
  const t = await getTranslations('purchaseOrders.receive');
  const number = purchaseOrderNumber(order.number);
  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t('title')}
        description={`${t('description', { number })} ${t('warehouse', {
          warehouse: `${order.warehouse.branchCode} ${order.warehouse.name}`,
        })}`}
        backHref={`/purchase-orders/${order.id}`}
        backLabel={t('back', { number })}
      />
      <ReceiveForm
        orderId={order.id}
        number={number}
        lines={order.lines.map((line) => ({
          id: line.id,
          code: line.code,
          name: line.name,
          unit: line.unit,
          ordered: line.quantity,
          received: line.receivedQuantity,
          left: line.left,
          stocked: line.stocked,
        }))}
      />
    </div>
  );
}
