import { bulkQueueOverview } from '@comprobify/core';
import { ListOrdered } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { LiveRefresh } from '@/components/live-refresh';
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
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

export const generateMetadata = pageTitle('adminQueue');

// ADR-026: what bulk invoicing is working through, company by company, against the caps.
export default async function AdminQueuePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const overview = await bulkQueueOverview(actor, db);
  const t = await getTranslations('adminQueue');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />
      <LiveRefresh active />
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <dt className="text-sm text-muted-foreground">{t('inFlight')}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {t('ofCap', { count: overview.inFlight, cap: overview.limits.global })}
          </dd>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <dt className="text-sm text-muted-foreground">{t('waiting')}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{overview.waiting}</dd>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <dt className="text-sm text-muted-foreground">{t('perCompany')}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{overview.limits.perCompany}</dd>
        </div>
      </dl>
      <TableCard>
        {overview.companies.length === 0 ? (
          <EmptyState icon={ListOrdered} title={t('emptyTitle')} description={t('empty')} />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.company')}</StackHead>
                <StackHead className="text-right">{t('table.batches')}</StackHead>
                <StackHead className="text-right">{t('table.waiting')}</StackHead>
                <StackHead className="text-right">{t('table.inFlight')}</StackHead>
                <StackHead className="text-right">{t('table.failed')}</StackHead>
                <StackHead className="pr-4">{t('table.oldest')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {overview.companies.map((company) => (
                <StackRow key={company.tenantId}>
                  <StackCell heading className="pl-4">
                    <span className="break-words font-medium">{company.name}</span>
                    {company.isTwin && (
                      <ToneBadge tone="neutral" className="ml-2">
                        {t('twin')}
                      </ToneBadge>
                    )}
                  </StackCell>
                  <StackCell label={t('table.batches')} className="text-right tabular-nums">
                    {company.batches}
                  </StackCell>
                  <StackCell label={t('table.waiting')} className="text-right tabular-nums">
                    {company.waiting}
                  </StackCell>
                  <StackCell label={t('table.inFlight')} className="text-right tabular-nums">
                    {t('ofCap', { count: company.inFlight, cap: overview.limits.perCompany })}
                  </StackCell>
                  <StackCell label={t('table.failed')} className="text-right tabular-nums">
                    {company.failed}
                  </StackCell>
                  <StackCell label={t('table.oldest')} className="pr-4 tabular-nums">
                    {company.oldestWaiting ? when.format(new Date(company.oldestWaiting)) : '—'}
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
