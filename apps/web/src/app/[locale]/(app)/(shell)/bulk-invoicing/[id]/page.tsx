import { getBatch, hasFeature, isDomainError } from '@comprobify/core';
import { FileText } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FeatureLocked } from '@/components/feature-locked';
import { LiveRefresh } from '@/components/live-refresh';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { ProgressBar } from '@/components/progress-bar';
import { SectionCard } from '@/components/section-card';
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
import { BATCH_TONE, ITEM_TONE, ITEM_VIEWS } from '../batch-status';
import { RetryButton } from './retry-button';

export const generateMetadata = pageTitle('bulkBatch');

const PAGE_SIZE = 50;

// FR-BULK-3: the stack view. Progress, each item's status and its invoice, retry of what failed.
export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ locale, id }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'BULK_INVOICING')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('documents.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const page = Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1);
  let batch: Awaited<ReturnType<typeof getBatch>>;
  try {
    batch = await getBatch(actor, db, id, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('bulkInvoicing');
  const tError = await getTranslations('bulkInvoicingError');
  const tDocError = await getTranslations('documentsError');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  const started = when.format(batch.createdAt);
  const pages = Math.max(1, Math.ceil(batch.totalItems / PAGE_SIZE));
  const running = batch.status === 'PROCESSING';
  // Only what the batch itself failed to make can be retried; a rejected invoice is corrected.
  const retryable = batch.items.length > 0 ? batch.counts.FAILED : 0;
  const canRetry = actor.permissions.includes('documents.issue') && retryable > 0;
  const reason = (item: (typeof batch.items)[number]) => {
    if (item.errorCode)
      return tError.has(item.errorCode)
        ? tError(item.errorCode)
        : tDocError.has(item.errorCode)
          ? tDocError(item.errorCode)
          : (item.errorMessage ?? item.errorCode);
    return item.view === 'FAILED' && item.documentId ? t('rejected') : null;
  };

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={t('detail.title', { date: started })}
        description={t(`sources.${batch.source}`)}
        backHref="/bulk-invoicing"
        backLabel={t('back')}
        className="mb-0"
        action={canRetry && <RetryButton id={batch.id} count={batch.counts.FAILED} />}
      />
      <LiveRefresh active={running} />

      <SectionCard
        title={t('detail.progress')}
        action={
          <ToneBadge tone={BATCH_TONE[batch.status]}>{t(`statuses.${batch.status}`)}</ToneBadge>
        }
      >
        <ProgressBar
          label={t('progressLabel', { date: started })}
          total={batch.totalItems}
          done={batch.counts.AUTHORIZED}
          failed={batch.counts.FAILED}
        />
        <p className="mt-2 text-sm tabular-nums text-muted-foreground">
          {t('progress', { done: batch.counts.AUTHORIZED, total: batch.totalItems })}
          {batch.completedAt &&
            ` · ${t('detail.completedAt', { date: when.format(batch.completedAt) })}`}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {ITEM_VIEWS.map((view) => (
            <li key={view} className="rounded-lg border border-border p-3">
              <ToneBadge tone={ITEM_TONE[view]}>{t(`items.${view}`)}</ToneBadge>
              <p className="mt-2 text-xl font-semibold tabular-nums">{batch.counts[view]}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <TableCard>
        <StackTable aria-label={t('detail.items')}>
          <StackHeader>
            <StackRow className="bg-muted/40">
              <StackHead className="pl-4">{t('detail.position')}</StackHead>
              <StackHead>{t('detail.order')}</StackHead>
              <StackHead>{t('detail.invoice')}</StackHead>
              <StackHead>{t('detail.status')}</StackHead>
              <StackHead className="pr-4">{t('detail.reason')}</StackHead>
            </StackRow>
          </StackHeader>
          <StackBody>
            {batch.items.map((item) => (
              <StackRow key={item.id}>
                <StackCell heading className="pl-4 tabular-nums">
                  {item.position}
                </StackCell>
                <StackCell label={t('detail.order')} className="tabular-nums">
                  {item.saleOrderId && item.saleOrderNumber ? (
                    <Link href={`/sale-orders/${item.saleOrderId}`} className="hover:underline">
                      {`PV-${String(item.saleOrderNumber).padStart(6, '0')}`}
                    </Link>
                  ) : (
                    '—'
                  )}
                </StackCell>
                <StackCell label={t('detail.invoice')} className="tabular-nums">
                  {item.documentId ? (
                    <Link
                      href={`/documents/${item.documentId}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      {item.documentNumber}
                    </Link>
                  ) : (
                    '—'
                  )}
                </StackCell>
                <StackCell label={t('detail.status')}>
                  <ToneBadge tone={ITEM_TONE[item.view]}>{t(`items.${item.view}`)}</ToneBadge>
                </StackCell>
                <StackCell label={t('detail.reason')} className="pr-4">
                  <p className="break-words text-sm">{reason(item) ?? '—'}</p>
                </StackCell>
              </StackRow>
            ))}
          </StackBody>
        </StackTable>
      </TableCard>
      {pages > 1 && (
        <nav
          aria-label={t('pagination.label')}
          className="flex items-center justify-between gap-3 text-sm"
        >
          {page > 1 ? (
            <Link
              href={`/bulk-invoicing/${id}?page=${page - 1}`}
              className="text-sm underline-offset-4 hover:underline"
            >
              {t('pagination.previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">{t('pagination.page', { page, pages })}</span>
          {page < pages ? (
            <Link
              href={`/bulk-invoicing/${id}?page=${page + 1}`}
              className="text-sm underline-offset-4 hover:underline"
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
