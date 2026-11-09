import { getSaleOrder, hasFeature, isDomainError, saleOrderNumber } from '@comprobify/core';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { redirect } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { orderFormData } from '../../form-data';
import { OrderForm } from '../../order-form';

export const generateMetadata = pageTitle('editSaleOrder');

// FR-SAL-1, FR-SAL-5: a draft or a confirmed order is edited; anything else goes back.
export default async function EditSaleOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'SALE_ORDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('sales.manage')) return <NoAccess />;

  const { db } = await getRuntime();
  let order: Awaited<ReturnType<typeof getSaleOrder>>;
  try {
    order = await getSaleOrder(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  if (order.status !== 'DRAFT' && order.status !== 'CONFIRMED')
    return redirect({ href: `/sale-orders/${order.id}`, locale });
  const t = await getTranslations('saleOrders');
  const data = await orderFormData(actor, db);
  const number = saleOrderNumber(order.number);
  // An inactive client is kept on the form, so the order opens as it was saved.
  const clients =
    !order.client || data.clients.some((client) => client.id === order.client!.id)
      ? data.clients
      : [
          ...data.clients,
          {
            id: order.client.id,
            name: order.client.name,
            identification: order.client.identification,
            idTypeLabel: (await getTranslations('sri'))(`idTypes.${order.client.idType as '05'}`),
          },
        ];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('detail.title', { number })}
        description={
          order.status === 'CONFIRMED' ? t('form.editConfirmed') : t('form.editDescription')
        }
        backHref={`/sale-orders/${order.id}`}
        backLabel={t('form.backOrder', { number })}
      />
      <OrderForm
        {...data}
        clients={clients}
        draft={{
          id: order.id,
          number,
          clientId: order.clientId,
          warehouseId: order.warehouseId,
          notes: order.notes,
          lines: order.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
          })),
        }}
      />
    </div>
  );
}
