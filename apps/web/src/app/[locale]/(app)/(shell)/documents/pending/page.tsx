import { listPending } from '@comprobify/core';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
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
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { STATUS_TONE } from '../document-status';

export const generateMetadata = pageTitle('pendingDocuments');

// What a person has to do comes before what SRI still has to answer.
const NEEDS_ACTION = new Set(['RETURNED', 'NOT_AUTHORIZED', 'SEND_FAILED']);

// FR-DOC-12: everything not yet final, in two groups.
export default async function PendingDocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('documents.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const rows = await listPending(actor, db);
  const t = await getTranslations('documents');
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const date = (iso: string) => iso.split('-').reverse().join('/');
  const groups = [
    { key: 'action' as const, rows: rows.filter((row) => NEEDS_ACTION.has(row.status)) },
    { key: 'sri' as const, rows: rows.filter((row) => !NEEDS_ACTION.has(row.status)) },
  ].filter((group) => group.rows.length > 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('pending.title')}
        description={t('pending.description')}
        backHref="/documents"
        backLabel={t('pending.back')}
      />
      {groups.length === 0 ? (
        <TableCard>
          <EmptyState
            icon={CheckCircle2}
            title={t('pending.emptyTitle')}
            description={t('pending.empty')}
          />
        </TableCard>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`pending-${group.key}`}>
              <h2 id={`pending-${group.key}`} className="mb-3 text-sm font-semibold">
                {t(`pending.groups.${group.key}`)} ({group.rows.length})
              </h2>
              <TableCard>
                <StackTable aria-labelledby={`pending-${group.key}`}>
                  <StackHeader>
                    <StackRow className="bg-muted/40">
                      <StackHead className="pl-4">{t('table.number')}</StackHead>
                      <StackHead>{t('table.date')}</StackHead>
                      <StackHead>{t('table.buyer')}</StackHead>
                      <StackHead className="text-right">{t('table.total')}</StackHead>
                      <StackHead>{t('table.status')}</StackHead>
                      <StackHead className="pr-4">
                        <span className="sr-only">{t('table.open', { number: '' })}</span>
                      </StackHead>
                    </StackRow>
                  </StackHeader>
                  <StackBody>
                    {group.rows.map((row) => (
                      <StackRow key={row.id}>
                        <StackCell heading className="pl-4">
                          <Link
                            href={`/documents/${row.id}`}
                            className="font-medium tabular-nums hover:underline"
                          >
                            {t(`types.${row.documentType as '01'}`)} {row.number}
                          </Link>
                        </StackCell>
                        <StackCell label={t('table.date')} className="tabular-nums">
                          {date(row.issueDate)}
                        </StackCell>
                        <StackCell label={t('table.buyer')}>{row.buyerName}</StackCell>
                        <StackCell label={t('table.total')} className="text-right tabular-nums">
                          {money.format(row.total as Intl.StringNumericLiteral)}
                        </StackCell>
                        <StackCell label={t('table.status')}>
                          <ToneBadge tone={STATUS_TONE[row.status]}>
                            {t(`statuses.${row.status}`)}
                          </ToneBadge>
                          {row.sriUnreachable && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {t('pending.unreachable')}
                            </span>
                          )}
                        </StackCell>
                        <StackCell className="pr-4 text-right">
                          <Link
                            href={`/documents/${row.id}`}
                            aria-label={t('table.open', { number: row.number })}
                            className="inline-flex rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          </Link>
                        </StackCell>
                      </StackRow>
                    ))}
                  </StackBody>
                </StackTable>
              </TableCard>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
