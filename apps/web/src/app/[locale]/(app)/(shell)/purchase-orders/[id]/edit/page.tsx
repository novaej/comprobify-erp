import { getPurchaseOrder, hasFeature, isDomainError, purchaseOrderNumber } from '@comprobify/core';
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

export const generateMetadata = pageTitle('editPurchaseOrder');

// FR-PUR-1: only a draft is edited; anything else goes back to the order.
export default async function EditPurchaseOrderPage({
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
  let order: Awaited<ReturnType<typeof getPurchaseOrder>>;
  try {
    order = await getPurchaseOrder(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  if (order.status !== 'DRAFT') return redirect({ href: `/purchase-orders/${order.id}`, locale });
  const t = await getTranslations('purchaseOrders');
  const data = await orderFormData(actor, db);
  const number = purchaseOrderNumber(order.number);
  // An inactive provider is kept on the form, so the draft opens as it was saved.
  const providers = data.providers.some((provider) => provider.id === order.providerId)
    ? data.providers
    : [
        ...data.providers,
        {
          id: order.provider.id,
          name: order.provider.name,
          identification: order.provider.identification,
          idTypeLabel: (await getTranslations('sri'))(`idTypes.${order.provider.idType as '04'}`),
        },
      ];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('detail.title', { number })}
        description={t('form.editDescription')}
        backHref={`/purchase-orders/${order.id}`}
        backLabel={t('form.backOrder', { number })}
      />
      <OrderForm
        {...data}
        providers={providers}
        draft={{
          id: order.id,
          number,
          providerId: order.providerId,
          warehouseId: order.warehouseId,
          expectedDate: order.expectedDate,
          notes: order.notes,
          lines: order.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitCost: line.unitCost,
          })),
        }}
      />
    </div>
  );
}
