import {
  correctionDraft,
  ecuadorDate,
  isDomainError,
  systemClock,
  type CorrectionDraft,
} from '@comprobify/core';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { redirect } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { invoiceFormData } from '../../new/form-data';
import { InvoiceForm } from '../../new/invoice-form';

export const generateMetadata = pageTitle('correctInvoice');

// FR-DOC-7: the invoice form, filled with the document as last signed.
export default async function CorrectInvoicePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('documents.issue')) return <NoAccess />;

  const { db } = await getRuntime();
  let draft: CorrectionDraft;
  try {
    draft = await correctionDraft(actor, db, id);
  } catch (error) {
    // No longer correctable, say SRI answered meanwhile: back to the document.
    if (isDomainError(error, 'NOT_CORRECTABLE'))
      return redirect({ href: `/documents/${id}`, locale });
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const data = await invoiceFormData(actor);
  const t = await getTranslations('invoiceForm');
  const [year, month, day] = ecuadorDate(systemClock.now()).split('-');

  return (
    <div className="max-w-7xl">
      <PageHeader
        title={t('correct.title', { number: draft.number })}
        description={t('correct.description')}
        backHref={`/documents/${draft.id}`}
        backLabel={t('correct.back')}
      />
      <InvoiceForm
        {...data}
        // The document keeps its issue point and number.
        issuePoints={[{ value: draft.issuePointId, label: draft.issuePoint }]}
        today={`${day}/${month}/${year}`}
        draft={{
          documentId: draft.id,
          clientId: draft.clientId,
          lines: draft.lines,
          payments: draft.payments,
          additionalInfo: draft.additionalInfo,
        }}
      />
    </div>
  );
}
