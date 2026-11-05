import { ecuadorDate, systemClock } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Store } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadShell } from '@/server/shell';
import { invoiceFormData } from './form-data';
import { InvoiceForm } from './invoice-form';

export const generateMetadata = pageTitle('newInvoice');

// FR-DOC-2, FR-UX-4: a factura, line by line from the keyboard.
export default async function NewInvoicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('documents.issue')) return <NoAccess />;

  const data = await invoiceFormData(actor);
  const t = await getTranslations('invoiceForm');
  const [year, month, day] = ecuadorDate(systemClock.now()).split('-');

  return (
    <div className="max-w-7xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        backHref="/documents"
        backLabel={t('back')}
      />
      {data.issuePoints.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t('issuing.none')}
          action={
            actor.permissions.includes('organization.manage') ? (
              <Link href="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('issuing.noneAction')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <InvoiceForm {...data} today={`${day}/${month}/${year}`} />
      )}
    </div>
  );
}
