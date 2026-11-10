import { cardAttemptsToResolve } from '@comprobify/core';
import { CreditCard } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
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
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { ResolveButton } from './resolve-button';

export const generateMetadata = pageTitle('adminCards');

// ADR-033: card money captured but never applied, a second charge or a wrong amount. Each is
// reversed by hand in Payphone's dashboard (same day until 20:00 Quito time), then settled here.
export default async function AdminCardsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const rows = await cardAttemptsToResolve(actor, db);
  const t = await getTranslations('adminCards');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  const money = (cents: number) =>
    `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />
      <TableCard>
        {rows.length === 0 ? (
          <EmptyState icon={CreditCard} title={t('emptyTitle')} description={t('empty')} />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.company')}</StackHead>
                <StackHead>{t('table.kind')}</StackHead>
                <StackHead>{t('table.payphone')}</StackHead>
                <StackHead>{t('table.card')}</StackHead>
                <StackHead>{t('table.when')}</StackHead>
                <StackHead className="text-right">{t('table.amount')}</StackHead>
                <StackHead>
                  <span className="sr-only">{t('table.actions')}</span>
                </StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {rows.map((row) => (
                <StackRow key={row.id}>
                  <StackCell heading className="pl-4">
                    <Link
                      href={`/admin/companies/${row.realTenantId}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {row.company.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {row.company.ruc} · {row.paymentCode}
                    </span>
                  </StackCell>
                  <StackCell label={t('table.kind')}>
                    <ToneBadge tone={row.status === 'DUPLICATE' ? 'warning' : 'danger'}>
                      {t(`kinds.${row.status}`)}
                    </ToneBadge>
                  </StackCell>
                  <StackCell label={t('table.payphone')} className="font-mono text-xs">
                    {row.payphoneTransactionId ?? '—'}
                    <span className="block text-muted-foreground">{row.clientTransactionId}</span>
                  </StackCell>
                  <StackCell label={t('table.card')}>
                    {row.cardBrand ?? '—'}
                    {row.cardLastDigits && (
                      <span className="block text-xs text-muted-foreground">
                        •••• {row.cardLastDigits}
                      </span>
                    )}
                  </StackCell>
                  <StackCell label={t('table.when')}>
                    {row.confirmedAt ? when.format(row.confirmedAt) : '—'}
                  </StackCell>
                  <StackCell label={t('table.amount')} className="text-right tabular-nums">
                    {money(row.amountCents)}
                  </StackCell>
                  <StackCell className="text-right">
                    <ResolveButton
                      attemptId={row.id}
                      label={`${row.company.name} · ${money(row.amountCents)}`}
                    />
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        )}
      </TableCard>
    </div>
  );
}
