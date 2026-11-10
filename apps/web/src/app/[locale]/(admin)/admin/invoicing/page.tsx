import { invoicingQueue } from '@comprobify/core';
import { ReceiptText } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PaymentLabel } from '@/components/billing/payment-label-cell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
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
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { InvoiceButton } from './invoice-button';

export const generateMetadata = pageTitle('adminInvoicing');

// FR-BILL-4: verified payments the operator still owes an invoice for, oldest first. The invoice
// is issued from the operator's own company, then recorded here.
export default async function AdminInvoicingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const rows = await invoicingQueue(actor, db);
  const t = await getTranslations('adminInvoicing');
  const tMethods = await getTranslations('plan.history.methods');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />
      <TableCard>
        {rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title={t('emptyTitle')} description={t('empty')} />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.company')}</StackHead>
                <StackHead>{t('table.what')}</StackHead>
                <StackHead>{t('table.verified')}</StackHead>
                <StackHead>{t('table.method')}</StackHead>
                <StackHead className="text-right">{t('table.total')}</StackHead>
                <StackHead>
                  <span className="sr-only">{t('table.actions')}</span>
                </StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {rows.map((row) => (
                <StackRow key={row.id}>
                  <StackCell heading className="pl-4">
                    <Link
                      href={`/admin/payments/${row.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {row.company.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {row.company.ruc} · {row.code}
                    </span>
                  </StackCell>
                  <StackCell label={t('table.what')}>
                    <PaymentLabel payment={row} />
                  </StackCell>
                  <StackCell label={t('table.verified')}>
                    {row.verifiedAt ? when.format(row.verifiedAt) : '—'}
                  </StackCell>
                  <StackCell label={t('table.method')}>
                    {row.method ? tMethods(row.method) : '—'}
                  </StackCell>
                  <StackCell label={t('table.total')} className="text-right tabular-nums">
                    ${row.totalAmount}
                  </StackCell>
                  <StackCell className="text-right">
                    <InvoiceButton paymentId={row.id} label={`${row.company.name} · ${row.code}`} />
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        )}
      </TableCard>
    </div>
  );
}
