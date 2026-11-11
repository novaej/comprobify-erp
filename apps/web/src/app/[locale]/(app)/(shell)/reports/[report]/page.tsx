import {
  isDomainError,
  REPORTS,
  runReport,
  SALES_GROUPS,
  type ReportKey,
  type ReportResult,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { cn } from '@comprobify/ui/lib/utils';
import { AlertCircle, BarChart3, Download } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
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
import { hasFeature } from '@comprobify/core';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { reportTable } from '@/server/report-table';
import { ReportFilters } from './report-filters';

// What a person reads on screen; the download has every row.
const SCREEN_ROWS = 200;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; report: string }>;
}) {
  const { locale, report } = await params;
  const t = await getTranslations({ locale, namespace: 'reports' });
  return {
    title: t.has(`reports.${report}.name` as 'reports.sales.name')
      ? t(`reports.${report}.name` as 'reports.sales.name')
      : t('title'),
  };
}

// FR-REP-2: one page for the reports that are tables of a range: sales, documents issued and
// the tax summary. The receivables aging has its own screen and only borrows the download.
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; report: string }>;
  searchParams: Promise<{ from?: string; to?: string; groupBy?: string }>;
}) {
  const [{ locale, report: key }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  if (!(REPORTS as readonly string[]).includes(key) || key === 'aging') notFound();
  const report = key as Exclude<ReportKey, 'aging'>;
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'REPORTS_BASIC')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('reports.read') || !actor.permissions.includes('documents.read'))
    return <NoAccess />;

  const { db } = await getRuntime();
  const t = await getTranslations('reports');
  const tError = await getTranslations('reportsError');
  const groupBy = (SALES_GROUPS as readonly string[]).includes(search.groupBy ?? '')
    ? (search.groupBy as (typeof SALES_GROUPS)[number])
    : undefined;
  // A hand-edited URL with a bad date falls back to the month so far.
  const date = (value?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value : undefined);
  let result: ReportResult | null = null;
  let problem: string | null = null;
  try {
    result = await runReport(
      actor,
      db,
      { report, from: date(search.from), to: date(search.to), groupBy },
      { limit: SCREEN_ROWS },
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    problem = tError.has(error.code as 'REPORT_RANGE_INVALID')
      ? tError(error.code as 'REPORT_RANGE_INVALID')
      : tError('UNKNOWN');
  }
  const table = result ? await reportTable(result, locale, 'screen') : null;
  const canExport = actor.permissions.includes('reports.export');
  const query = result
    ? new URLSearchParams({
        from: result.from,
        to: result.to,
        ...(result.groupBy ? { groupBy: result.groupBy } : {}),
      }).toString()
    : '';

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t(`reports.${report}.name` as 'reports.sales.name')}
        description={t(`reports.${report}.description` as 'reports.sales.description')}
        backHref="/reports"
        backLabel={t('back')}
        action={
          canExport && result && result.rows.length > 0 ? (
            // A file download, not a page: a plain link to the route.
            <a
              href={`/${locale}/reports/${report}/csv?${query}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              {t('download')}
            </a>
          ) : undefined
        }
      />
      <ReportFilters
        from={result?.from ?? search.from ?? ''}
        to={result?.to ?? search.to ?? ''}
        {...(report === 'sales'
          ? {
              groupBy: result?.groupBy ?? 'day',
              groups: SALES_GROUPS.map((value) => ({ value, label: t(`groups.${value}`) })),
            }
          : {})}
      />
      {problem && (
        <Banner tone="danger" icon={AlertCircle}>
          {problem}
        </Banner>
      )}
      {table && result && (
        <>
          <TableCard>
            {table.rows.length === 0 ? (
              <EmptyState icon={BarChart3} title={t('emptyTitle')} description={t('empty')} />
            ) : (
              <StackTable aria-label={t(`reports.${report}.name` as 'reports.sales.name')}>
                <StackHeader>
                  <StackRow className="bg-muted/40">
                    {table.headers.map((header, index) => (
                      <StackHead
                        key={header}
                        className={cn(
                          index === 0 && 'pl-4',
                          ['amount', 'quantity', 'integer', 'percent'].includes(
                            table.columns[index]!.kind,
                          ) && 'text-right',
                        )}
                      >
                        {header}
                      </StackHead>
                    ))}
                  </StackRow>
                </StackHeader>
                <StackBody>
                  {table.rows.map((row, rowIndex) => (
                    <StackRow key={rowIndex}>
                      {row.map((value, index) => {
                        const numeric = ['amount', 'quantity', 'integer', 'percent'].includes(
                          table.columns[index]!.kind,
                        );
                        return (
                          <StackCell
                            key={index}
                            heading={index === 0}
                            label={index === 0 ? undefined : table.headers[index]}
                            className={cn(
                              index === 0 && 'pl-4',
                              numeric && 'text-right tabular-nums',
                            )}
                          >
                            {value}
                          </StackCell>
                        );
                      })}
                    </StackRow>
                  ))}
                  {table.totals && (
                    <StackRow className="bg-muted/40 font-medium">
                      {table.totals.map((value, index) => (
                        <StackCell
                          key={index}
                          heading={index === 0}
                          label={index === 0 ? undefined : table.headers[index]}
                          className={cn(
                            index === 0 && 'pl-4',
                            value !== '' && index > 0 && 'text-right tabular-nums',
                          )}
                        >
                          {index === 0 ? t('total') : value}
                        </StackCell>
                      ))}
                    </StackRow>
                  )}
                </StackBody>
              </StackTable>
            )}
          </TableCard>
          {result.truncated && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('truncated', { count: SCREEN_ROWS })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
