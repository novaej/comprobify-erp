import { listCompanies } from '@comprobify/core';
import { Badge } from '@comprobify/ui/components/badge';
import { Button } from '@comprobify/ui/components/button';
import { Card, CardContent } from '@comprobify/ui/components/card';
import { Input } from '@comprobify/ui/components/input';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getRuntime } from '@/server/runtime';
import { loadPlatform } from '@/server/platform';

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('companiesTitle')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('companiesDescription')}</p>
      </div>
      <form className="flex max-w-md gap-2" role="search">
        <Input
          name="q"
          type="search"
          defaultValue={q ?? ''}
          aria-label={t('search')}
          placeholder={t('search')}
        />
        <Button type="submit" variant="outline">
          {t('searchButton')}
        </Button>
      </form>
      <Card>
        <CardContent>
          {companies.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('noCompanies')}</p>
          ) : (
            <ul className="divide-y divide-border" aria-label={t('companiesTitle')}>
              {companies.map((company) => (
                <li key={company.realTenantId}>
                  <Link
                    href={`/admin/companies/${company.realTenantId}`}
                    className="flex flex-col gap-1 py-3 text-sm hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{company.name}</span>
                      <span className="text-muted-foreground tabular-nums">{company.ruc}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary">
                        {english
                          ? company.subscription.plan.nameEn
                          : company.subscription.plan.nameEs}
                      </Badge>
                      {company.subscription.billing === 'COMPLIMENTARY' && (
                        <Badge variant="outline">{t('complimentary')}</Badge>
                      )}
                      <Badge variant="outline">{company.liveAt ? t('live') : t('notLive')}</Badge>
                      {company.status === 'SUSPENDED' && (
                        <Badge variant="destructive">{t('suspended')}</Badge>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
