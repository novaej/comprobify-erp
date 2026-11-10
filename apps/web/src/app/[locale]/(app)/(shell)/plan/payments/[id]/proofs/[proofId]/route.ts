import { isDomainError, proofFile } from '@comprobify/core';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-BILL-3: a transfer's proof, shown inline; core checks the role and the company.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ locale: string; id: string; proofId: string }> },
) {
  const { locale, id, proofId } = await params;
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  try {
    const file = await proofFile(actor, db, { paymentId: id, proofId });
    return new Response(new Uint8Array(file.content), {
      headers: {
        // The type core read from the file's own bytes, never from its name.
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
