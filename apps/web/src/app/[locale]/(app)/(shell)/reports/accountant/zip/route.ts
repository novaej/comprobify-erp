import { accountantExport, isDomainError } from '@comprobify/core';
import { redirect } from 'next/navigation';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-REP-3: a month's authorized XMLs as one ZIP. Core checks the export permission. A month with
// nothing to export goes back to the reports page, which says so, instead of a blank download.
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const month = new URL(request.url).searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response(null, { status: 404 });
  let made: Awaited<ReturnType<typeof accountantExport>>;
  try {
    made = await accountantExport(actor, db, month);
  } catch (error) {
    if (isDomainError(error, 'EXPORT_EMPTY') || isDomainError(error, 'EXPORT_TOO_LARGE'))
      return redirect(
        `/${locale}/reports?problem=${error.code}&month=${encodeURIComponent(month)}`,
      );
    if (isDomainError(error)) return new Response(null, { status: 404 });
    throw error;
  }
  return new Response(new Uint8Array(made.zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${made.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
