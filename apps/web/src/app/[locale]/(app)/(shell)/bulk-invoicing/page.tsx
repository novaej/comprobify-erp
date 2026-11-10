import { hasFeature, listBatches } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { ChevronRight, Layers, Plus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { FeatureLocked } from '@/components/feature-locked';
import { LiveRefresh } from '@/components/live-refresh';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { ProgressBar } from '@/components/progress-bar';
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
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { BATCH_TONE } from './batch-status';

export const generateMetadata = pageTitle('bulkInvoicing');

// FR-BULK-3: every batch, newest first, with how far along it is.
export default async function BulkInvoicingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'BULK_INVOICING')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('documents.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const pageSize = 25;
  const page = Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1);
  const list = await listBatches(actor, db, { limit: pageSize, offset: (page - 1) * pageSize });
  const t = await getTranslations('bulkInvoicing');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  const pages = Math.max(1, Math.ceil(list.total / pageSize));
  const canStart =
    actor.permissions.includes('documents.issue') && actor.permissions.includes('sales.manage');
  const running = list.rows.some((row) => row.status === 'PROCESSING');
  const start = canStart && (
    <Link href="/bulk-invoicing/new" className={buttonVariants({ size: 'sm' })}>
      <Plus className="mr-1.5 h-4 w-4" aria-hidden />
      {t('new')}
    </Link>
  );

  return (
    <div className="max-w-6xl">
      <PageHeader title={t('title')} description={t('description')} action={start} />
      <div className="mb-3">
        <LiveRefresh active={running} />
      </div>
      <TableCard>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={t('emptyTitle')}
            description={t('empty')}
            action={start || undefined}
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.started')}</StackHead>
                <StackHead>{t('table.source')}</StackHead>
                <StackHead className="w-56">{t('table.progress')}</StackHead>
                <StackHead>{t('table.failed')}</StackHead>
                <StackHead>{t('table.status')}</StackHead>
                <StackHead className="pr-4">
                  <span className="sr-only">{t('table.open', { date: '' })}</span>
                </StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {list.rows.map((row) => {
                const started = when.format(row.createdAt);
                const done = row.counts.AUTHORIZED;
                return (
                  <StackRow key={row.id}>
                    <StackCell heading className="pl-4">
                      <Link
                        href={`/bulk-invoicing/${row.id}`}
                        className="font-medium tabular-nums hover:underline"
                      >
                        {started}
                      </Link>
                    </StackCell>
                    <StackCell label={t('table.source')}>{t(`sources.${row.source}`)}</StackCell>
                    <StackCell label={t('table.progress')}>
                      <ProgressBar
                        label={t('progressLabel', { date: started })}
                        total={row.totalItems}
                        done={done}
                        failed={row.counts.FAILED}
                        className="mb-1"
                      />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t('progress', { done, total: row.totalItems })}
                      </span>
                    </StackCell>
                    <StackCell label={t('table.failed')} className="tabular-nums">
                      {row.counts.FAILED}
                    </StackCell>
                    <StackCell label={t('table.status')}>
                      <ToneBadge tone={BATCH_TONE[row.status]}>
                        {t(`statuses.${row.status}`)}
                      </ToneBadge>
                    </StackCell>
                    <StackCell className="pr-4 text-right">
                      <Link
                        href={`/bulk-invoicing/${row.id}`}
                        aria-label={t('table.open', { date: started })}
                        className="inline-flex rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </StackCell>
                  </StackRow>
                );
              })}
            </StackBody>
          </StackTable>
        )}
      </TableCard>
      {pages > 1 && (
        <nav
          aria-label={t('pagination.label')}
          className="mt-4 flex items-center justify-between gap-3 text-sm"
        >
          {page > 1 ? (
            <Link
              href={{ pathname: '/bulk-invoicing', query: { page: String(page - 1) } }}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('pagination.previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">{t('pagination.page', { page, pages })}</span>
          {page < pages ? (
            <Link
              href={{ pathname: '/bulk-invoicing', query: { page: String(page + 1) } }}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('pagination.next')}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
