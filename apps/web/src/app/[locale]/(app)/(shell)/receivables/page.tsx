import {
  agingFilters,
  agingReport,
  AGING_BUCKETS,
  hasFeature,
  type AgingFilters,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { cn } from '@comprobify/ui/lib/utils';
import { HandCoins } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
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
import { ToneBadge, type Tone } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

export const generateMetadata = pageTitle('receivables');

const BUCKET_TONE: Record<(typeof AGING_BUCKETS)[number], Tone> = {
  CURRENT: 'success',
  D1_30: 'info',
  D31_60: 'warning',
  D61_90: 'warning',
  D90_PLUS: 'danger',
};

// FR-SAL-10: what clients owe, by how late it is. A bucket's card filters the list.
export default async function ReceivablesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ bucket?: string; buyer?: string }>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'RECEIVABLES')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('sales.read')) return <NoAccess />;

  const { db } = await getRuntime();
  // A hand-edited URL with a bad filter shows everything rather than an error.
  const parsed = agingFilters.safeParse({
    bucket: search.bucket || undefined,
    buyer: search.buyer || undefined,
  });
  const filters: AgingFilters = parsed.success ? parsed.data : {};
  const report = await agingReport(actor, db, filters);
  const t = await getTranslations('receivables');
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const amount = (value: string) => money.format(value as Intl.StringNumericLiteral);
  const date = (iso: string) => iso.split('-').reverse().join('/');

  return (
    <div className="max-w-6xl">
      <PageHeader title={t('title')} description={t('description', { date: date(report.asOf) })} />
      <section aria-labelledby="aging-title" className="mb-6">
        <h2 id="aging-title" className="sr-only">
          {t('summary')}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {report.buckets.map((bucket) => {
            const selected = filters.bucket === bucket.bucket;
            return (
              <li key={bucket.bucket}>
                <Link
                  href={{
                    pathname: '/receivables',
                    query: {
                      ...(selected ? {} : { bucket: bucket.bucket }),
                      ...(filters.buyer ? { buyer: filters.buyer } : {}),
                    },
                  }}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'block rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40',
                    selected ? 'border-primary' : 'border-border',
                  )}
                >
                  <ToneBadge tone={BUCKET_TONE[bucket.bucket]}>
                    {t(`buckets.${bucket.bucket}`)}
                  </ToneBadge>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    {amount(bucket.balance)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('invoices', { count: bucket.count })}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">{t('total')} </span>
          <span className="font-semibold tabular-nums">{amount(report.total)}</span>
          {(filters.bucket || filters.buyer) && (
            <Link
              href="/receivables"
              className="ml-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {t('clear')}
            </Link>
          )}
        </p>
      </section>

      <TableCard>
        {report.rows.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title={filters.bucket || filters.buyer ? t('noMatchesTitle') : t('emptyTitle')}
            description={filters.bucket || filters.buyer ? t('noMatches') : t('empty')}
            action={
              filters.bucket || filters.buyer ? (
                <Link
                  href="/receivables"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('clear')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.invoice')}</StackHead>
                <StackHead>{t('table.client')}</StackHead>
                <StackHead>{t('table.due')}</StackHead>
                <StackHead>{t('table.late')}</StackHead>
                <StackHead className="text-right">{t('table.total')}</StackHead>
                <StackHead className="pr-4 text-right">{t('table.balance')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {report.rows.map((row) => (
                <StackRow key={row.id}>
                  <StackCell heading className="pl-4">
                    <Link
                      href={`/documents/${row.id}`}
                      className="font-medium tabular-nums hover:underline"
                    >
                      {row.number}
                    </Link>
                  </StackCell>
                  <StackCell label={t('table.client')}>
                    <Link
                      href={{
                        pathname: '/receivables',
                        query: {
                          buyer: row.buyerIdentification,
                          ...(filters.bucket ? { bucket: filters.bucket } : {}),
                        },
                      }}
                      className="break-words hover:underline"
                    >
                      {row.buyerName}
                    </Link>
                  </StackCell>
                  <StackCell label={t('table.due')} className="tabular-nums">
                    {date(row.dueDate)}
                  </StackCell>
                  <StackCell label={t('table.late')}>
                    <ToneBadge tone={BUCKET_TONE[row.bucket]}>
                      {row.daysOverdue > 0 ? t('daysLate', { days: row.daysOverdue }) : t('notDue')}
                    </ToneBadge>
                  </StackCell>
                  <StackCell label={t('table.total')} className="text-right tabular-nums">
                    {amount(row.total)}
                  </StackCell>
                  <StackCell
                    label={t('table.balance')}
                    className="pr-4 text-right font-medium tabular-nums"
                  >
                    {amount(row.balance)}
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
