import { getDocument, isDomainError, type DocumentDetail } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Store } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Link, redirect } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { creditFormData } from '../../credit-note/form-data';
import { CreditNoteForm } from '../../credit-note/credit-note-form';

export const generateMetadata = pageTitle('newCreditNote');

// FR-DOC-9: a nota de crédito from an authorized invoice, for part or all of it.
export default async function NewCreditNotePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('documents.issue')) return <NoAccess />;

  const { db } = await getRuntime();
  let origin: DocumentDetail;
  let data: Awaited<ReturnType<typeof creditFormData>>;
  try {
    origin = await getDocument(actor, db, id);
    data = await creditFormData(actor, id);
  } catch (error) {
    // Not creditable now (say it was voided meanwhile): back to the invoice.
    if (
      isDomainError(error, 'ORIGIN_NOT_INVOICE') ||
      isDomainError(error, 'ORIGIN_NOT_AUTHORIZED') ||
      isDomainError(error, 'CREDIT_NOTE_NEEDS_BUYER')
    )
      return redirect({ href: `/documents/${id}`, locale });
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('creditNoteForm');

  return (
    <div className="max-w-7xl">
      <PageHeader
        title={t('title', { number: origin.number })}
        description={t('description')}
        backHref={`/documents/${id}`}
        backLabel={t('back')}
      />
      {data.issuePoints.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t('issuing.none')}
          action={
            actor.permissions.includes('organization.manage') ? (
              <Link href="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('issuing.noneAction')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <CreditNoteForm originId={id} originNumber={origin.number} {...data} />
      )}
    </div>
  );
}
