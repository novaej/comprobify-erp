import { documentRide, isDomainError } from '@comprobify/core';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-DOC-10: the RIDE, inline so the browser shows it; core checks the role.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale, id } = await params;
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  try {
    const ride = await documentRide(actor, db, id);
    return new Response(new Uint8Array(ride.content), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${ride.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isDomainError(error) || (error instanceof Error && error.name === 'ZodError'))
      return new Response(null, { status: 404 });
    throw error;
  }
}
