import { isDomainError, PAYMENT_REJECTION_REASONS, paymentForReview } from '@comprobify/core';
import { FileText } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PaymentLabel } from '@/components/billing/payment-label-cell';
import { STATUS_TONE } from '@/components/billing/payment-status';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { ReviewActions } from './review-actions';

export const generateMetadata = pageTitle('adminPayment');

// FR-ADM-2, FR-BILL-3: one payment, every proof the company sent (taken out ones too) and the
// operator's decision on it.
export default async function AdminPaymentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const payment = await paymentForReview(actor, db, id).catch((error: unknown) => {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  });
  const t = await getTranslations('adminPayments');
  const tPayment = await getTranslations('plan.payment');
  const tMethods = await getTranslations('plan.history.methods');
  const tNav = await getTranslations('adminNav');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  const facts: [string, string][] = [
    [tPayment('base'), `$${payment.baseAmount}`],
    [tPayment('iva', { rate: Number(payment.ivaRate) }), `$${payment.ivaAmount}`],
    [tPayment('total'), `$${payment.totalAmount}`],
    [tPayment('code'), payment.code],
    [t('detail.created'), when.format(payment.createdAt)],
    [t('detail.reported'), payment.reportedAt ? when.format(payment.reportedAt) : '—'],
    [t('detail.verified'), payment.verifiedAt ? when.format(payment.verifiedAt) : '—'],
    [t('detail.method'), payment.method ? tMethods(payment.method) : '—'],
  ];
  const image = (type: string) => type.startsWith('image/');

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title={payment.company.name}
        description={`${payment.company.ruc} · ${payment.code}`}
        backHref="/admin/payments"
        backLabel={tNav('payments')}
        className="mb-2"
      />
      <SectionCard
        title={t('detail.title')}
        description={<PaymentLabel payment={payment} />}
        action={
          <ToneBadge tone={STATUS_TONE[payment.status]}>
            {tPayment(`status.${payment.status}`)}
          </ToneBadge>
        }
      >
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {facts.map(([name, value]) => (
            <div
              key={name}
              className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
            >
              <dt className="text-xs text-muted-foreground">{name}</dt>
              <dd className="text-sm font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {payment.rejectionReason && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('detail.rejectedFor', { reason: tPayment(`reasons.${payment.rejectionReason}`) })}
          </p>
        )}
        {payment.refundReason && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('detail.refundedFor', { reason: payment.refundReason })}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/admin/companies/${payment.realTenantId}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('detail.company')}
          </Link>
          <ReviewActions
            paymentId={payment.id}
            status={payment.status}
            label={`${payment.company.name} · ${payment.code}`}
            reasons={PAYMENT_REJECTION_REASONS}
          />
        </div>
      </SectionCard>

      <SectionCard title={t('detail.proofs')} description={t('detail.proofsHint')}>
        {payment.proofList.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.noProofs')}</p>
        ) : (
          <ul className="space-y-4" aria-label={t('detail.proofs')}>
            {payment.proofList.map((proof) => {
              const href = `/${locale}/admin/payments/${payment.id}/proofs/${proof.id}`;
              return (
                <li key={proof.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {proof.filename}
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {t('detail.reference', { reference: proof.reference })} ·{' '}
                      {when.format(proof.createdAt)}
                    </span>
                    {!proof.active && <ToneBadge tone="neutral">{t('detail.removed')}</ToneBadge>}
                  </div>
                  {image(proof.contentType) && (
                    // A proof is the company's own upload, served from our route: no next/image.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={href}
                      alt={t('detail.proofAlt', { file: proof.filename })}
                      className="mt-3 max-h-[32rem] w-auto rounded-md border border-border"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
