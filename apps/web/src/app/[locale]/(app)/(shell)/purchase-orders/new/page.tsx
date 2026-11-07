import { hasFeature } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { AlertCircle, Truck } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { orderFormData } from '../form-data';
import { OrderForm } from '../order-form';

export const generateMetadata = pageTitle('newPurchaseOrder');

// FR-PUR-1: a new order starts as a draft.
export default async function NewPurchaseOrderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'PURCHASE_ORDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('purchasing.manage')) return <NoAccess />;

  const { db } = await getRuntime();
  const t = await getTranslations('purchaseOrders');
  const data = await orderFormData(actor, db);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('new')}
        description={t('form.newDescription')}
        backHref="/purchase-orders"
        backLabel={t('form.back')}
      />
      {data.warehouses.length === 0 ? (
        <Banner tone="warning" icon={AlertCircle}>
          {t('noWarehouses')}
        </Banner>
      ) : data.providers.length === 0 ? (
        <SectionCard title={t('form.provider.title')}>
          <EmptyState
            icon={Truck}
            title={t('noProviders.title')}
            description={t('noProviders.description')}
            action={
              actor.permissions.includes('providers.manage') ? (
                <Link href="/providers" className={buttonVariants({ size: 'sm' })}>
                  {t('noProviders.action')}
                </Link>
              ) : undefined
            }
          />
        </SectionCard>
      ) : (
        <OrderForm {...data} />
      )}
    </div>
  );
}
