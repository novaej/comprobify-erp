import { agreementStatus } from '@comprobify/core';
import { FileText } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
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
import { Link } from '@/i18n/navigation';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { AcceptAgreementsForm } from './accept-form';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('legal');

const SLUGS = { TERMS: 'terms', PRIVACY: 'privacy', DPA: 'dpa' } as const;

// FR-ONB-8: every member can read the company's texts; only the owner accepts them.
export default async function LegalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  const { db, agreementParties } = await getRuntime();
  const t = await getTranslations('legal');

  if (!agreementParties) {
    return (
      <div className="max-w-3xl">
        <PageHeader title={t('title')} />
        <TableCard>
          <EmptyState
            icon={FileText}
            title={t('underReviewTitle')}
            description={t('underReview')}
          />
        </TableCard>
      </div>
    );
  }

  const status = await agreementStatus(actor, db);
  const pending = status.some((row) => !row.accepted);
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />
      <TableCard>
        <StackTable aria-label={t('title')}>
          <StackHeader>
            <StackRow className="bg-muted/40">
              <StackHead className="pl-4">{t('table.document')}</StackHead>
              <StackHead>{t('table.version')}</StackHead>
              <StackHead className="pr-4">{t('table.status')}</StackHead>
            </StackRow>
          </StackHeader>
          <StackBody>
            {status.map((row) => (
              <StackRow key={row.type}>
                <StackCell heading className="pl-4">
                  <Link
                    href={`/legal/${SLUGS[row.type]}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {t(`types.${row.type}`)}
                  </Link>
                </StackCell>
                <StackCell label={t('table.version')} className="tabular-nums">
                  v{row.version}
                </StackCell>
                <StackCell label={t('table.status')} className="pr-4 whitespace-nowrap">
                  {row.accepted && row.acceptedAt ? (
                    <ToneBadge tone="success">
                      {t('acceptedOn', { date: when.format(row.acceptedAt) })}
                    </ToneBadge>
                  ) : (
                    <ToneBadge tone="warning">{t('pending')}</ToneBadge>
                  )}
                </StackCell>
              </StackRow>
            ))}
          </StackBody>
        </StackTable>
      </TableCard>
      {pending &&
        (actor.permissions.includes('organization.accept_agreements') ? (
          <SectionCard title={t('acceptTitle')} description={t('acceptDescription')}>
            <AcceptAgreementsForm
              pending={status.filter((row) => !row.accepted).map((row) => row.type)}
            />
          </SectionCard>
        ) : (
          <p className="text-sm text-muted-foreground">{t('ownerAccepts')}</p>
        ))}
    </div>
  );
}
