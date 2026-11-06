import {
  correctionDraft,
  creditNoteDraft,
  ecuadorDate,
  getDocument,
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
import { CreditNoteForm } from '../../credit-note/credit-note-form';
import { creditFormData } from '../../credit-note/form-data';
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
  let kind: string;
  try {
    kind = (await getDocument(actor, db, id)).documentType;
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  if (kind === '04') return <CorrectCreditNote locale={locale} id={id} />;

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

// FR-DOC-7: the credit note form, filled with the note as last signed.
async function CorrectCreditNote({ locale, id }: { locale: string; id: string }) {
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  let draft: Awaited<ReturnType<typeof creditNoteDraft>>;
  let data: Awaited<ReturnType<typeof creditFormData>>;
  try {
    draft = await creditNoteDraft(actor, db, id);
    data = await creditFormData(actor, draft.originId);
  } catch (error) {
    if (isDomainError(error, 'NOT_CORRECTABLE'))
      return redirect({ href: `/documents/${id}`, locale });
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('creditNoteForm');
  return (
    <div className="max-w-7xl">
      <PageHeader
        title={t('correct.title', { number: draft.number })}
        description={t('correct.description')}
        backHref={`/documents/${draft.id}`}
        backLabel={t('correct.back')}
      />
      <CreditNoteForm
        {...data}
        originId={draft.originId}
        originNumber={draft.originNumber}
        // The document keeps its issue point and number.
        issuePoints={[{ value: draft.issuePointId, label: draft.issuePoint }]}
        draft={{
          documentId: draft.id,
          reason: draft.reason,
          lines: draft.lines,
        }}
      />
    </div>
  );
}
