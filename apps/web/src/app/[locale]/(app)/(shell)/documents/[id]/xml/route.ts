import { documentXml, isDomainError } from '@comprobify/core';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-DOC-12: SRI's <autorizacion> once authorized, the signed XML before.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale, id } = await params;
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  try {
    const xml = await documentXml(actor, db, id);
    return new Response(xml.content, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${xml.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isDomainError(error) || (error instanceof Error && error.name === 'ZodError'))
      return new Response(null, { status: 404 });
    throw error;
  }
}
