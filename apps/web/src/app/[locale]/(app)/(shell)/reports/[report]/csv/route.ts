import { isDomainError, REPORTS, runReport, SALES_GROUPS, toCsv } from '@comprobify/core';
import { reportTable } from '@/server/report-table';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

const date = (value: string | null) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value! : undefined;

// FR-REP-2: every row of a report, in the format the locale's spreadsheet opens directly. Core
// checks the export permission, so the link on the page is only a convenience.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; report: string }> },
) {
  const { locale, report } = await params;
  if (!(REPORTS as readonly string[]).includes(report)) return new Response(null, { status: 404 });
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const search = new URL(request.url).searchParams;
  const groupBy = search.get('groupBy') ?? '';
  try {
    const result = await runReport(
      actor,
      db,
      {
        report: report as (typeof REPORTS)[number],
        from: date(search.get('from')),
        to: date(search.get('to')),
        groupBy: (SALES_GROUPS as readonly string[]).includes(groupBy)
          ? (groupBy as (typeof SALES_GROUPS)[number])
          : undefined,
      },
      { export: true },
    );
    const table = await reportTable(result, locale, 'csv');
    const body = toCsv(
      [
        table.headers,
        ...table.rows,
        ...(table.totals ? [table.totals.map((value, index) => (index === 0 ? '' : value))] : []),
      ],
      // Spanish Excel: ';' between fields and ',' for decimals.
      locale === 'en' ? ',' : ';',
    );
    const name = report === 'aging' ? result.to : `${result.from}_${result.to}`;
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-${report}-${name}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isDomainError(error)) return new Response(null, { status: 404 });
    throw error;
  }
}
