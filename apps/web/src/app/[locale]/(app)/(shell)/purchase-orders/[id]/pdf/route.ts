import { isDomainError, purchaseOrderPdf } from '@comprobify/core';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-PUR-3: the order's PDF, inline so the browser shows it; core checks the role.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale, id } = await params;
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  try {
    const pdf = await purchaseOrderPdf(actor, db, id);
    return new Response(new Uint8Array(pdf.content), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${pdf.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isDomainError(error) || (error instanceof Error && error.name === 'ZodError'))
      return new Response(null, { status: 404 });
    throw error;
  }
}
