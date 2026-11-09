import { hasFeature } from '@comprobify/core';
import { AlertCircle } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { orderFormData } from '../form-data';
import { OrderForm } from '../order-form';

export const generateMetadata = pageTitle('newSaleOrder');

// FR-SAL-1: a new order starts as a draft.
export default async function NewSaleOrderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'SALE_ORDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('sales.manage')) return <NoAccess />;

  const { db } = await getRuntime();
  const t = await getTranslations('saleOrders');
  const data = await orderFormData(actor, db);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('new')}
        description={t('form.newDescription')}
        backHref="/sale-orders"
        backLabel={t('form.back')}
      />
      {data.warehouses.length === 0 ? (
        <Banner tone="warning" icon={AlertCircle}>
          {t('noWarehouses')}
        </Banner>
      ) : (
        <OrderForm {...data} />
      )}
    </div>
  );
}
