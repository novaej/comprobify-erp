import {
  correctionDraft,
  creditNoteDraft,
  ecuadorDate,
  CARRIER_ID_TYPES,
  getDocument,
  guideDraft,
  isDomainError,
  orderInvoiceDraft,
  saleOrderNumber,
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
import { GuideForm } from '../../guide/guide-form';
import { CreditNoteForm } from '../../credit-note/credit-note-form';
import { creditFormData } from '../../credit-note/form-data';
import { invoiceFormData } from '../../new/form-data';
import { InvoiceForm } from '../../new/invoice-form';
import { orderInvoiceFormData } from '../../../sale-orders/invoice-data';
import { OrderInvoiceForm } from '../../../sale-orders/[id]/invoice/order-invoice-form';

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
  let fromOrder: boolean;
  try {
    const found = await getDocument(actor, db, id);
    kind = found.documentType;
    fromOrder = found.saleOrder !== null;
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  if (kind === '04') return <CorrectCreditNote locale={locale} id={id} />;
  if (kind === '06') return <CorrectGuide locale={locale} id={id} />;
  // An invoice made from a sale order is corrected through the order (ADR-022).
  if (fromOrder) return <CorrectOrderInvoice locale={locale} id={id} />;

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
          returnStock: draft.returnStock,
          lines: draft.lines,
        }}
      />
    </div>
  );
}

// FR-DOC-7: the guía form, filled with the guía as last signed. A later day needs new dates.
async function CorrectGuide({ locale, id }: { locale: string; id: string }) {
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  let draft: Awaited<ReturnType<typeof guideDraft>>;
  try {
    draft = await guideDraft(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_CORRECTABLE'))
      return redirect({ href: `/documents/${id}`, locale });
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('guideForm');
  const tSri = await getTranslations('sri');
  const today = ecuadorDate(systemClock.now());
  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t('correct.title', { number: draft.number })}
        description={t('correct.description')}
        backHref={`/documents/${draft.id}`}
        backLabel={t('correct.back')}
      />
      <GuideForm
        issuePoints={[{ value: draft.issuePointId, label: draft.issuePoint }]}
        carrierTypes={CARRIER_ID_TYPES.map((code) => ({
          value: code,
          label: tSri(`idTypes.${code}`),
        }))}
        today={today}
        originId={draft.originId}
        originNumber={null}
        initial={{
          ...draft.content,
          // A date in the past can't be sent today: the person moves it.
          transportStart:
            draft.content.transportStart < today ? today : draft.content.transportStart,
          transportEnd: draft.content.transportEnd < today ? today : draft.content.transportEnd,
        }}
        draft={{ documentId: draft.id }}
      />
    </div>
  );
}

// FR-DOC-7, FR-SAL-4: the order's lines, with this invoice's own quantities as they were.
async function CorrectOrderInvoice({ locale, id }: { locale: string; id: string }) {
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  let draft: Awaited<ReturnType<typeof orderInvoiceDraft>>;
  try {
    draft = await orderInvoiceDraft(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_CORRECTABLE'))
      return redirect({ href: `/documents/${id}`, locale });
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('saleOrders.invoice');
  const data = await orderInvoiceFormData(actor, draft.lines);
  const payment = draft.payments[0];
  const number = saleOrderNumber(draft.order.number);

  return (
    <div className="max-w-7xl">
      <PageHeader
        title={t('correct.title', { number: draft.number })}
        description={t('correct.description')}
        backHref={`/documents/${draft.id}`}
        backLabel={t('correct.back', { number: draft.number })}
      />
      <OrderInvoiceForm
        orderId={draft.order.id}
        orderNumber={number}
        {...data}
        issuePoints={[{ value: draft.issuePointId, label: draft.issuePoint }]}
        draft={{
          documentId: draft.id,
          method: payment?.method ?? '01',
          term: payment?.term === null || payment?.term === undefined ? '' : String(payment.term),
          termUnit: payment?.termUnit ?? '',
        }}
      />
    </div>
  );
}
