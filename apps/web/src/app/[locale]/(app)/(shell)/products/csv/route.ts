import { exportProducts, isDomainError, toCsv } from '@comprobify/core';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// Every products row, in the format the locale's spreadsheet opens directly and an import reads
// back. Core checks the role and the plan, so the link on the page is only a convenience.
export async function GET(_: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  const spanish = locale !== 'en';
  try {
    const rows = await exportProducts(actor, db, {
      locale: spanish ? 'es' : 'en',
      decimal: spanish ? ',' : '.',
    });
    // Spanish Excel: ';' between fields and ',' for decimals.
    return new Response(toCsv(rows, spanish ? ';' : ','), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="products.csv"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isDomainError(error)) return new Response(null, { status: 404 });
    throw error;
  }
}
