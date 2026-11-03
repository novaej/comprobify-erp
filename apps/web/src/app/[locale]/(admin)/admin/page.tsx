import { listCompanies } from '@comprobify/core';
import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Building2, Search } from 'lucide-react';
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

export const generateMetadata = pageTitle('admin');

// FR-ADM-1: every company, newest first, searchable by RUC or name.
export default async function AdminCompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ locale }, { q }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const companies = await listCompanies(actor, db, { query: q });
  const t = await getTranslations('admin');
  const english = locale === 'en';

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title={t('companiesTitle')}
        description={t('companiesDescription')}
        className="mb-2"
      />
      <form className="flex max-w-md gap-2" role="search">
        <Input
          name="q"
          type="search"
          defaultValue={q ?? ''}
          aria-label={t('search')}
          placeholder={t('search')}
        />
        <Button type="submit" variant="outline">
          <Search className="mr-1.5 h-4 w-4" aria-hidden />
          {t('searchButton')}
        </Button>
      </form>
      <TableCard>
        {companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={q ? t('noMatchesTitle') : t('noCompaniesTitle')}
            description={q ? t('noMatches') : t('noCompanies')}
          />
        ) : (
          <StackTable aria-label={t('companiesTitle')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.company')}</StackHead>
                <StackHead>{t('table.plan')}</StackHead>
                <StackHead className="pr-4">{t('table.status')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {companies.map((company) => (
                <StackRow key={company.realTenantId}>
                  <StackCell heading className="pl-4">
                    <Link
                      href={`/admin/companies/${company.realTenantId}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {company.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{company.ruc}</p>
                  </StackCell>
                  <StackCell label={t('table.plan')}>
                    <span className="flex flex-wrap gap-1.5">
                      <ToneBadge tone="neutral">
                        {english
                          ? company.subscription.plan.nameEn
                          : company.subscription.plan.nameEs}
                      </ToneBadge>
                      {company.subscription.billing === 'COMPLIMENTARY' && (
                        <ToneBadge tone="primary">{t('complimentary')}</ToneBadge>
                      )}
                    </span>
                  </StackCell>
                  <StackCell label={t('table.status')} className="pr-4">
                    <span className="flex flex-wrap gap-1.5">
                      {company.liveAt ? (
                        <ToneBadge tone="success">{t('live')}</ToneBadge>
                      ) : (
                        <ToneBadge tone="warning">{t('notLive')}</ToneBadge>
                      )}
                      {company.status === 'SUSPENDED' && (
                        <ToneBadge tone="danger">{t('suspended')}</ToneBadge>
                      )}
                    </span>
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
