import { getDocument, isDomainError, type DocumentDetail } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { cn } from '@comprobify/ui/lib/utils';
import { AlertCircle, Download, FileText } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { DetailTile } from '@/components/detail-tile';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge } from '@/components/tone-badge';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { STATUS_TONE } from '../document-status';
import { CopyButton } from './copy-button';

export const generateMetadata = pageTitle('document');

type SriMessage = { identifier: string; message: string; additionalInfo: string | null };

// SRI's reasons for the latest DEVUELTA or NO AUTORIZADO, from the timeline.
function latestMessages(document: DocumentDetail): SriMessage[] {
  const event = [...document.events].reverse().find((item) => item.toStatus === document.status);
  const messages = event?.details.messages;
  return Array.isArray(messages) ? (messages as SriMessage[]) : [];
}

// FR-DOC-12: one document, what SRI answered, and its files.
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('documents.read')) return <NoAccess />;

  const { db } = await getRuntime();
  let document: DocumentDetail;
  try {
    document = await getDocument(actor, db, id);
  } catch (error) {
    if (isDomainError(error, 'NOT_FOUND') || (error instanceof Error && error.name === 'ZodError'))
      notFound();
    throw error;
  }
  const t = await getTranslations('documents');
  const tSri = await getTranslations('sri');
  const format = await getFormatter();
  const money = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const amount = (value: string) => money.format(value as Intl.StringNumericLiteral);
  const date = (iso: string) => iso.split('-').reverse().join('/');
  const when = (at: Date) => format.dateTime(at, { dateStyle: 'medium', timeStyle: 'short' });
  const rate = (code: string) => tSri(`ivaRates.${code as '4'}`);
  const type = t(`types.${document.documentType as '01'}`);
  const messages = ['RETURNED', 'NOT_AUTHORIZED'].includes(document.status)
    ? latestMessages(document)
    : [];
  const authorized = document.status === 'AUTHORIZED' || document.status === 'VOIDED';
  const base = `/${locale}/documents/${document.id}`;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        className="mb-0"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">
              {t('detail.title', { type, number: document.number })}
            </span>
            <ToneBadge tone={STATUS_TONE[document.status]}>
              {t(`statuses.${document.status}`)}
            </ToneBadge>
          </span>
        }
        description={t(`statusHelp.${document.status}`)}
        backHref="/documents"
        backLabel={t('detail.back')}
        action={
          <>
            {authorized && (
              <a
                href={`${base}/ride`}
                target="_blank"
                rel="noopener"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <FileText className="mr-1.5 h-4 w-4" aria-hidden />
                {t('detail.downloads.rideView')}
              </a>
            )}
            <a
              href={`${base}/xml`}
              download
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              {t('detail.downloads.xml')}
            </a>
          </>
        }
      />

      {messages.length > 0 && (
        <Banner
          tone="danger"
          icon={AlertCircle}
          title={t(`detail.sriMessages.${document.status as 'RETURNED'}`)}
          className="mb-0"
        >
          <ul className="mt-1 space-y-1">
            {messages.map((message, index) => (
              <li key={index}>
                <span className="font-medium">{message.identifier}.</span> {message.message}
                {message.additionalInfo && (
                  <span className="block text-xs opacity-90">{message.additionalInfo}</span>
                )}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <SectionCard title={t('detail.summary')}>
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <DetailTile
            label={t('detail.total')}
            value={<span className="text-base tabular-nums">{amount(document.total)}</span>}
          />
          <DetailTile
            label={t('detail.issueDate')}
            value={<span className="tabular-nums">{date(document.issueDate)}</span>}
          />
          <DetailTile
            label={t('detail.issuePoint')}
            value={<span className="tabular-nums">{document.issuePoint}</span>}
          />
          <DetailTile label={t('detail.buyer')} value={document.buyer.name} />
          <DetailTile
            label={t('detail.identification')}
            value={<span className="tabular-nums">{document.buyer.identification}</span>}
            detail={tSri(`idTypes.${document.buyer.idType as '04'}`)}
          />
          {document.buyer.email && (
            <DetailTile
              label={t('detail.email')}
              value={<span className="break-all">{document.buyer.email}</span>}
            />
          )}
          <DetailTile
            label={t('detail.ambiente')}
            value={t(`detail.ambientes.${document.ambiente as '1'}`)}
          />
          {document.authorizedAt && (
            <DetailTile label={t('detail.authorizedAt')} value={when(document.authorizedAt)} />
          )}
        </dl>
        <div className="mt-4 rounded-md bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">{t('detail.accessKey')}</p>
          <p className="flex items-center gap-1 font-mono text-xs break-all">
            {document.accessKey}
            <CopyButton
              value={document.accessKey}
              label={t('detail.copy')}
              done={t('detail.copied')}
            />
          </p>
        </div>
        {document.previousKeys.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium">{t('detail.previousKeys')}</p>
            <p className="text-xs text-muted-foreground">{t('detail.previousKeysDescription')}</p>
            <ul className="mt-1 space-y-0.5 font-mono text-xs break-all text-muted-foreground">
              {document.previousKeys.map((key) => (
                <li key={key.accessKey}>
                  {key.accessKey} ({date(key.issueDate)})
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="lines-title">
            <h2 id="lines-title" className="mb-3 text-sm font-semibold">
              {t('detail.lines.title')}
            </h2>
            <TableCard>
              <StackTable aria-labelledby="lines-title">
                <StackHeader>
                  <StackRow className="bg-muted/40">
                    <StackHead className="pl-4">{t('detail.lines.description')}</StackHead>
                    <StackHead className="text-right">{t('detail.lines.quantity')}</StackHead>
                    <StackHead className="text-right">{t('detail.lines.unitPrice')}</StackHead>
                    <StackHead className="text-right">{t('detail.lines.discount')}</StackHead>
                    <StackHead>{t('detail.lines.iva')}</StackHead>
                    <StackHead className="pr-4 text-right">{t('detail.lines.total')}</StackHead>
                  </StackRow>
                </StackHeader>
                <StackBody>
                  {document.lines.map((line, index) => (
                    <StackRow key={index}>
                      <StackCell heading className="pl-4">
                        <p className="font-medium">{line.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{line.code}</p>
                      </StackCell>
                      <StackCell
                        label={t('detail.lines.quantity')}
                        className="text-right tabular-nums"
                      >
                        {format.number(Number(line.quantity), { maximumFractionDigits: 6 })}
                      </StackCell>
                      <StackCell
                        label={t('detail.lines.unitPrice')}
                        className="text-right tabular-nums"
                      >
                        {format.number(Number(line.unitPrice), {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 6,
                        })}
                      </StackCell>
                      <StackCell
                        label={t('detail.lines.discount')}
                        className="text-right tabular-nums"
                      >
                        {amount(line.discount)}
                      </StackCell>
                      <StackCell label={t('detail.lines.iva')}>{rate(line.ivaRateCode)}</StackCell>
                      <StackCell
                        label={t('detail.lines.total')}
                        className="pr-4 text-right tabular-nums"
                      >
                        {amount(line.base)}
                      </StackCell>
                    </StackRow>
                  ))}
                </StackBody>
              </StackTable>
            </TableCard>
          </section>

          <SectionCard title={t('detail.timeline.title')}>
            <ol className="space-y-4">
              {document.events.map((event) => {
                const reached = event.toStatus && event.type === 'STATUS_CHANGED';
                const eventMessages = Array.isArray(event.details.messages)
                  ? (event.details.messages as SriMessage[])
                  : [];
                const label =
                  event.type === 'REISSUED'
                    ? t('detail.timeline.events.REISSUED', {
                        date: date(
                          typeof event.details.issueDate === 'string'
                            ? event.details.issueDate
                            : '',
                        ),
                      })
                    : reached
                      ? t(`detail.timeline.reached.${event.toStatus as 'RECEIVED'}`)
                      : t(`detail.timeline.events.${event.type as 'CREATED'}`);
                return (
                  <li key={event.id} className="flex gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2',
                        event.toStatus === 'AUTHORIZED'
                          ? 'border-success bg-success'
                          : event.toStatus === 'RETURNED' || event.toStatus === 'NOT_AUTHORIZED'
                            ? 'border-destructive bg-destructive'
                            : event.toStatus === 'SEND_FAILED'
                              ? 'border-warning bg-warning'
                              : 'border-border bg-card',
                      )}
                    />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{when(event.occurredAt)}</p>
                      {event.type === 'EMAILED' && typeof event.details.to === 'string' && (
                        <p className="text-xs break-all text-muted-foreground">
                          {event.details.to}
                        </p>
                      )}
                      {eventMessages.length > 0 && (
                        <ul
                          className="mt-1 space-y-0.5 text-xs text-muted-foreground"
                          aria-label={t('detail.timeline.messages')}
                        >
                          {eventMessages.map((message, index) => (
                            <li key={index}>
                              {message.identifier}. {message.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </SectionCard>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6">
          <section
            aria-labelledby="totals-title"
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <h2 id="totals-title" className="text-sm font-semibold">
              {t('detail.totals.title')}
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              {document.taxTotals.map((tax) => (
                <div key={`base-${tax.rateCode}`} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {t('detail.totals.subtotal', { rate: rate(tax.rateCode) })}
                  </dt>
                  <dd className="tabular-nums">{amount(tax.base)}</dd>
                </div>
              ))}
              {Number(document.discount) > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t('detail.totals.discount')}</dt>
                  <dd className="tabular-nums">{amount(document.discount)}</dd>
                </div>
              )}
              {document.taxTotals
                .filter((tax) => Number(tax.value) > 0)
                .map((tax) => (
                  <div key={`iva-${tax.rateCode}`} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{rate(tax.rateCode)}</dt>
                    <dd className="tabular-nums">{amount(tax.value)}</dd>
                  </div>
                ))}
            </dl>
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-4">
              <span className="text-sm font-medium">{t('detail.totals.total')}</span>
              <span className="text-2xl font-semibold tracking-tight tabular-nums">
                {amount(document.total)}
              </span>
            </div>
          </section>
          <SectionCard title={t('detail.payments.title')}>
            <ul className="space-y-2 text-sm">
              {document.payments.map((payment, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {tSri(`paymentMethods.${payment.method as '01'}`)}
                    {payment.term !== null && payment.termUnit && (
                      <span className="block text-xs text-muted-foreground">
                        {t('detail.payments.term', {
                          term: payment.term,
                          unit: tSri(`termUnits.${payment.termUnit as 'dias'}`).toLowerCase(),
                        })}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">{amount(payment.amount)}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
          {!authorized && (
            <p className="text-xs text-muted-foreground">{t('detail.downloads.rideLater')}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
