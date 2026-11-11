import { failedJobs, jobsOverview, overdueDocuments } from '@comprobify/core';
import { CheckCircle2, FileClock } from 'lucide-react';
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
import { RetryJobButton } from './retry-job-button';

export const generateMetadata = pageTitle('adminJobs');

// FR-ADM-5: how each queue is doing, the jobs that failed (with a retry), and the documents SRI has
// held for more than a day, across companies.
export default async function AdminJobsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const [queues, failed, overdue] = await Promise.all([
    jobsOverview(actor, db),
    failedJobs(actor, db),
    overdueDocuments(actor, db),
  ]);
  const t = await getTranslations('adminJobs');
  const tDocs = await getTranslations('documents');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });
  const at = (date: Date | null) => (date ? when.format(date) : '—');

  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader title={t('title')} description={t('description')} className="mb-0" />
      <LiveRefresh active />

      <section aria-labelledby="queues-title" className="space-y-3">
        <h2 id="queues-title" className="text-sm font-semibold">
          {t('queuesTitle')}
        </h2>
        <TableCard>
          <StackTable aria-labelledby="queues-title">
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('queue')}</StackHead>
                <StackHead>{t('schedule')}</StackHead>
                <StackHead className="text-right">{t('waiting')}</StackHead>
                <StackHead className="text-right">{t('active')}</StackHead>
                <StackHead className="text-right">{t('completed')}</StackHead>
                <StackHead className="text-right">{t('failed')}</StackHead>
                <StackHead>{t('lastRun')}</StackHead>
                <StackHead className="pr-4">{t('lastFailure')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {queues.map((queue) => (
                <StackRow key={queue.queue}>
                  <StackCell heading className="pl-4 font-mono text-xs">
                    {queue.queue}
                  </StackCell>
                  <StackCell label={t('schedule')} className="font-mono text-xs">
                    {queue.schedule ?? '—'}
                  </StackCell>
                  <StackCell label={t('waiting')} className="text-right tabular-nums">
                    {queue.counts.created + queue.counts.retry}
                  </StackCell>
                  <StackCell label={t('active')} className="text-right tabular-nums">
                    {queue.counts.active}
                  </StackCell>
                  <StackCell label={t('completed')} className="text-right tabular-nums">
                    {queue.counts.completed}
                  </StackCell>
                  <StackCell label={t('failed')} className="text-right tabular-nums">
                    {queue.counts.failed > 0 ? (
                      <ToneBadge tone="danger">{queue.counts.failed}</ToneBadge>
                    ) : (
                      0
                    )}
                  </StackCell>
                  <StackCell label={t('lastRun')} className="tabular-nums">
                    {at(queue.lastCompletedAt)}
                  </StackCell>
                  <StackCell label={t('lastFailure')} className="pr-4 tabular-nums">
                    {at(queue.lastFailedAt)}
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        </TableCard>
      </section>

      <section aria-labelledby="failed-title" className="space-y-3">
        <h2 id="failed-title" className="text-sm font-semibold">
          {t('failedTitle')}
        </h2>
        <TableCard>
          {failed.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={t('failedEmptyTitle')}
              description={t('failedEmpty')}
            />
          ) : (
            <StackTable aria-labelledby="failed-title">
              <StackHeader>
                <StackRow className="bg-muted/40">
                  <StackHead className="pl-4">{t('queue')}</StackHead>
                  <StackHead>{t('failedAt')}</StackHead>
                  <StackHead className="text-right">{t('retries')}</StackHead>
                  <StackHead>{t('error')}</StackHead>
                  <StackHead className="pr-4">
                    <span className="sr-only">{t('actions')}</span>
                  </StackHead>
                </StackRow>
              </StackHeader>
              <StackBody>
                {failed.map((job) => (
                  <StackRow key={job.id}>
                    <StackCell heading className="pl-4 font-mono text-xs">
                      {job.queue}
                    </StackCell>
                    <StackCell label={t('failedAt')} className="tabular-nums">
                      {at(job.failedAt)}
                    </StackCell>
                    <StackCell label={t('retries')} className="text-right tabular-nums">
                      {job.retries}
                    </StackCell>
                    <StackCell label={t('error')}>
                      <p className="max-w-md break-words text-xs text-muted-foreground">
                        {job.message ?? '—'}
                      </p>
                    </StackCell>
                    <StackCell className="pr-4 text-right">
                      <RetryJobButton queue={job.queue} id={job.id} />
                    </StackCell>
                  </StackRow>
                ))}
              </StackBody>
            </StackTable>
          )}
        </TableCard>
      </section>

      <section aria-labelledby="overdue-title" className="space-y-3">
        <div>
          <h2 id="overdue-title" className="text-sm font-semibold">
            {t('overdueTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('overdueDescription')}</p>
        </div>
        <TableCard>
          {overdue.length === 0 ? (
            <EmptyState
              icon={FileClock}
              title={t('overdueEmptyTitle')}
              description={t('overdueEmpty')}
            />
          ) : (
            <StackTable aria-labelledby="overdue-title">
              <StackHeader>
                <StackRow className="bg-muted/40">
                  <StackHead className="pl-4">{t('company')}</StackHead>
                  <StackHead>{t('document')}</StackHead>
                  <StackHead className="pr-4">{t('receivedAt')}</StackHead>
                </StackRow>
              </StackHeader>
              <StackBody>
                {overdue.map((row) => (
                  <StackRow key={row.id}>
                    <StackCell heading className="pl-4">
                      {row.company}
                      {row.isTwin && (
                        <span className="ml-2">
                          <ToneBadge tone="warning">{t('test')}</ToneBadge>
                        </span>
                      )}
                    </StackCell>
                    <StackCell label={t('document')} className="tabular-nums">
                      {tDocs.has(`types.${row.documentType}` as 'types.01')
                        ? tDocs(`types.${row.documentType}` as 'types.01')
                        : row.documentType}{' '}
                      {row.number}
                    </StackCell>
                    <StackCell label={t('receivedAt')} className="pr-4 tabular-nums">
                      {at(row.receivedAt)}
                    </StackCell>
                  </StackRow>
                ))}
              </StackBody>
            </StackTable>
          )}
        </TableCard>
      </section>
    </div>
  );
}
