import { documentExchanges, RETENTION } from '@comprobify/core';
import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { FileSearch, Search } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
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
import { ToneBadge, type Tone } from '@/components/tone-badge';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { STATUS_TONE } from '../../../(app)/(shell)/documents/document-status';

export const generateMetadata = pageTitle('adminExchanges');

const OUTCOME_TONE: Record<string, Tone> = {
  AUTHORIZED: 'success',
  RECEIVED: 'info',
  PENDING: 'info',
  PENDING_VOID: 'info',
  VOIDED: 'neutral',
  RETURNED: 'danger',
  NOT_AUTHORIZED: 'danger',
  NOT_FOUND: 'warning',
  TRANSPORT_ERROR: 'warning',
};

// How much of a raw answer is drawn; the stored copy is whole.
const RAW_SHOWN = 20_000;

// FR-DOC-13: what SRI answered to each call for one document, found by its access key, for
// support. The raw answer is kept for a limited time; after it the summary of the call remains.
export default async function AdminExchangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ locale }, { q }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const t = await getTranslations('adminExchanges');
  const tDocs = await getTranslations('documents');
  const key = (q ?? '').replaceAll(/\s/g, '');
  const valid = /^\d{49}$/.test(key);
  const view = valid ? await documentExchanges(actor, db, key) : null;
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />
      <form role="search" className="flex max-w-2xl gap-2">
        <Input
          name="q"
          type="search"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={q ?? ''}
          aria-label={t('search')}
          placeholder={t('search')}
          className="font-mono"
        />
        <Button type="submit" variant="outline">
          <Search className="mr-1.5 h-4 w-4" aria-hidden />
          {t('searchButton')}
        </Button>
      </form>
      {q && !valid && (
        <p role="alert" className="text-sm text-destructive">
          {t('invalid')}
        </p>
      )}
      {valid && !view && (
        <TableCard>
          <EmptyState icon={FileSearch} title={t('notFoundTitle')} description={t('notFound')} />
        </TableCard>
      )}
      {view && (
        <>
          <SectionCard title={view.company} description={view.accessKey}>
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">{t('document')}</dt>
                <dd>
                  {tDocs.has(`types.${view.documentType}` as 'types.01')
                    ? tDocs(`types.${view.documentType}` as 'types.01')
                    : view.documentType}{' '}
                  <span className="tabular-nums">{view.number}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('status')}</dt>
                <dd>
                  <ToneBadge
                    tone={STATUS_TONE[view.status as keyof typeof STATUS_TONE] ?? 'neutral'}
                  >
                    {tDocs(`statuses.${view.status as 'AUTHORIZED'}`)}
                  </ToneBadge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('issued')}</dt>
                <dd className="tabular-nums">{view.issueDate.split('-').reverse().join('/')}</dd>
              </div>
              {view.isTwin && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('environment')}</dt>
                  <dd>
                    <ToneBadge tone="warning">{t('test')}</ToneBadge>
                  </dd>
                </div>
              )}
            </dl>
          </SectionCard>
          <TableCard>
            {view.exchanges.length === 0 ? (
              <EmptyState
                icon={FileSearch}
                title={t('noExchangesTitle')}
                description={t('noExchanges')}
              />
            ) : (
              <StackTable aria-label={t('table.label')}>
                <StackHeader>
                  <StackRow className="bg-muted/40">
                    <StackHead className="pl-4">{t('table.when')}</StackHead>
                    <StackHead>{t('table.call')}</StackHead>
                    <StackHead className="pr-4">{t('table.answer')}</StackHead>
                  </StackRow>
                </StackHeader>
                <StackBody>
                  {view.exchanges.map((entry) => (
                    <StackRow key={entry.id}>
                      <StackCell heading className="pl-4 tabular-nums">
                        {when.format(entry.occurredAt)}
                      </StackCell>
                      <StackCell label={t('table.call')}>
                        {t(`operations.${entry.operation as 'reception'}`)}
                        <span className="mt-1 block">
                          <ToneBadge tone={OUTCOME_TONE[entry.outcome] ?? 'neutral'}>
                            {t(`outcomes.${entry.outcome as 'RECEIVED'}`)}
                          </ToneBadge>
                        </span>
                      </StackCell>
                      <StackCell label={t('table.answer')} className="pr-4">
                        <p className="text-xs text-muted-foreground">
                          {[
                            entry.httpStatus ? `HTTP ${entry.httpStatus}` : null,
                            entry.host,
                            entry.source,
                            `${entry.durationMs} ms`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {entry.error && (
                          <p className="mt-1 text-sm break-words text-destructive">{entry.error}</p>
                        )}
                        {entry.messages.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-sm">
                            {entry.messages.map((message, index) => (
                              <li key={index} className="break-words">
                                <span className="tabular-nums text-muted-foreground">
                                  {message.identifier}
                                </span>{' '}
                                {message.message}
                                {message.additionalInfo ? ` — ${message.additionalInfo}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                        {entry.raw ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-primary">
                              {t('raw')}
                            </summary>
                            <pre
                              tabIndex={0}
                              className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs break-all whitespace-pre-wrap"
                            >
                              {entry.raw.slice(0, RAW_SHOWN)}
                            </pre>
                            {entry.raw.length > RAW_SHOWN && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t('rawCut', { count: RAW_SHOWN })}
                              </p>
                            )}
                          </details>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {t('rawCleared', { days: RETENTION.sriRawDays })}
                          </p>
                        )}
                      </StackCell>
                    </StackRow>
                  ))}
                </StackBody>
              </StackTable>
            )}
          </TableCard>
        </>
      )}
      {!q && (
        <TableCard>
          <EmptyState icon={FileSearch} title={t('startTitle')} description={t('start')} />
        </TableCard>
      )}
    </div>
  );
}
