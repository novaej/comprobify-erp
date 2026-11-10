import { isDomainError, proofFileForReview } from '@comprobify/core';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

// FR-ADM-2: a proof as the operator reviews it, the ones the company took out too.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ locale: string; id: string; proofId: string }> },
) {
  const { locale, id, proofId } = await params;
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  try {
    const file = await proofFileForReview(actor, db, { paymentId: id, proofId });
    return new Response(new Uint8Array(file.content), {
      headers: {
        // Read from the file's own bytes, never its name.
        'Content-Type': file.contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (isDomainError(error) || (error instanceof Error && error.name === 'ZodError'))
      return new Response(null, { status: 404 });
    throw error;
  }
}
