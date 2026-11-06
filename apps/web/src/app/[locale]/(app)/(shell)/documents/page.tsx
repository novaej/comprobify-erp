import {
  DOCUMENT_STATUSES,
  documentFilters,
  hasFeature,
  isDomainError,
  issuingOptions,
  listDocuments,
  type DocumentFilters as Filters,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { ChevronRight, Clock, FileText, Plus, Truck } from 'lucide-react';
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
import { DocumentFilters } from './document-filters';
import { STATUS_TONE } from './document-status';

export const generateMetadata = pageTitle('documents');

type Search = {
  status?: string;
  issuePointId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
};

// FR-DOC-12: every document, newest first, with what SRI answered.
export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  // No feature lock: documents stay readable whatever the plan (FR-PLAN-3).
  if (!actor.permissions.includes('documents.read')) return <NoAccess />;

  const { db } = await getRuntime();
  // A hand-edited URL with a bad filter shows everything rather than an error.
  const parsed = documentFilters.safeParse({
    status: search.status,
    issuePointId: search.issuePointId,
    from: search.from || undefined,
    to: search.to || undefined,
    query: search.q || undefined,
    page: search.page,
  });
  const filters: Filters = parsed.success ? parsed.data : {};
  const canIssue = actor.permissions.includes('documents.issue');
  const [list, options] = await Promise.all([
    listDocuments(actor, db, filters),
    canIssue
      ? issuingOptions(actor, db).catch((error: unknown) => {
          if (isDomainError(error)) return null;
          throw error;
        })
      : null,
  ]);
  const t = await getTranslations('documents');
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const date = (iso: string) => iso.split('-').reverse().join('/');
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const searching = Object.values(filters).some((value) => value !== undefined && value !== 1);
  const pageHref = (page: number) => ({
    pathname: '/documents' as const,
    query: { ...search, page: String(page) },
  });

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          <>
            <Link
              href="/documents/pending"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Clock className="mr-1.5 h-4 w-4" aria-hidden />
              {t('pendingLink')}
            </Link>
            {canIssue && hasFeature(actor, 'DOC_TYPE_06') && (
              <Link
                href="/documents/guide/new"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Truck className="mr-1.5 h-4 w-4" aria-hidden />
                {t('newGuide')}
              </Link>
            )}
            {canIssue && (
              <Link href="/documents/new" className={buttonVariants({ size: 'sm' })}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('newInvoice')}
              </Link>
            )}
          </>
        }
      />
      <DocumentFilters
        statuses={DOCUMENT_STATUSES.map((status) => ({
          value: status,
          label: t(`statuses.${status}`),
        }))}
        issuePoints={(options?.issuePoints ?? []).map((point) => ({
          value: point.id,
          label: `${point.code} ${point.branchName}`,
        }))}
        values={{
          status: search.status,
          issuePointId: search.issuePointId,
          from: search.from,
          to: search.to,
          q: search.q,
        }}
      />
      <TableCard>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={searching ? t('noMatchesTitle') : t('emptyTitle')}
            description={searching ? t('noMatches') : t('empty')}
            action={
              !searching && canIssue ? (
                <Link href="/documents/new" className={buttonVariants({ size: 'sm' })}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('newInvoice')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <StackTable aria-label={t('title')}>
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
              {list.rows.map((row) => (
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
                  <StackCell label={t('table.buyer')}>
                    <p className="break-words">{row.buyerName}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {row.buyerIdentification}
                    </p>
                  </StackCell>
                  <StackCell label={t('table.total')} className="text-right tabular-nums">
                    {money.format(row.total as Intl.StringNumericLiteral)}
                  </StackCell>
                  <StackCell label={t('table.status')}>
                    <ToneBadge tone={STATUS_TONE[row.status]}>
                      {t(`statuses.${row.status}`)}
                    </ToneBadge>
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
        )}
      </TableCard>
      {pages > 1 && (
        <nav
          aria-label={t('pagination.label')}
          className="mt-4 flex items-center justify-between gap-3 text-sm"
        >
          {list.page > 1 ? (
            <Link
              href={pageHref(list.page - 1)}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('pagination.previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {t('pagination.page', { page: list.page, pages })}
          </span>
          {list.page < pages ? (
            <Link
              href={pageHref(list.page + 1)}
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
