import { paymentsToReview } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Banknote } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PaymentLabel } from '@/components/billing/payment-label-cell';
import { STATUS_TONE } from '@/components/billing/payment-status';
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
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

export const generateMetadata = pageTitle('adminPayments');

const SHOWN = ['REPORTED', 'PENDING', 'REJECTED', 'VERIFIED', 'REFUNDED'] as const;
type Shown = (typeof SHOWN)[number];

// FR-ADM-2: transfers waiting for the operator first; the other states to look something up.
export default async function AdminPaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: asked } = await searchParams;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const status: Shown = SHOWN.includes(asked as Shown) ? (asked as Shown) : 'REPORTED';
  const rows = await paymentsToReview(actor, db, { status });
  const t = await getTranslations('adminPayments');
  const tStatus = await getTranslations('plan.payment.status');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />
      <nav aria-label={t('filter')} className="flex flex-wrap gap-2">
        {SHOWN.map((value) => (
          <Link
            key={value}
            href={value === 'REPORTED' ? '/admin/payments' : `/admin/payments?status=${value}`}
            aria-current={value === status ? 'page' : undefined}
            className={buttonVariants({
              size: 'sm',
              variant: value === status ? 'default' : 'outline',
            })}
          >
            {tStatus(value)}
          </Link>
        ))}
      </nav>
      <TableCard>
        {rows.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title={status === 'REPORTED' ? t('emptyReported') : t('empty')}
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.company')}</StackHead>
                <StackHead>{t('table.what')}</StackHead>
                <StackHead>{t('table.when')}</StackHead>
                <StackHead>{t('table.proofs')}</StackHead>
                <StackHead className="text-right">{t('table.total')}</StackHead>
                <StackHead>{t('table.status')}</StackHead>
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
                  <StackCell label={t('table.when')}>
                    {when.format(row.reportedAt ?? row.verifiedAt ?? row.createdAt)}
                  </StackCell>
                  <StackCell label={t('table.proofs')} className="tabular-nums">
                    {row.proofs}
                  </StackCell>
                  <StackCell label={t('table.total')} className="text-right tabular-nums">
                    ${row.totalAmount}
                  </StackCell>
                  <StackCell label={t('table.status')}>
                    <ToneBadge tone={STATUS_TONE[row.status]}>{tStatus(row.status)}</ToneBadge>
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
