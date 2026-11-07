import { CLIENT_ID_TYPES, hasFeature, listProviders, SRI_TERM_UNITS } from '@comprobify/core';
import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Search } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FeatureLocked } from '@/components/feature-locked';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { ProviderManager } from './provider-manager';

export const generateMetadata = pageTitle('providers');

// FR-MD-3: who the company buys from.
export default async function ProvidersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ locale }, { q }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'PROVIDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('purchasing.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const providers = await listProviders(actor, db, { query: q, includeInactive: true });
  const t = await getTranslations('providers');
  const tSri = await getTranslations('sri');

  return (
    <div className="max-w-6xl">
      <PageHeader title={t('title')} description={t('description')} />
      <form className="mb-4 flex max-w-md gap-2" role="search">
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
      <ProviderManager
        providers={providers.map((provider) => ({
          id: provider.id,
          idType: provider.idType,
          identification: provider.identification,
          name: provider.name,
          emails: provider.emails,
          phone: provider.phone,
          address: provider.address,
          paymentTerm: provider.paymentTerm,
          paymentTermUnit: provider.paymentTermUnit,
          active: provider.active,
        }))}
        idTypes={CLIENT_ID_TYPES.map((code) => ({
          value: code,
          label: tSri(`idTypes.${code as '04'}`),
        }))}
        termUnits={SRI_TERM_UNITS.map((code) => ({
          value: code,
          label: tSri(`termUnits.${code}`),
        }))}
        canManage={actor.permissions.includes('providers.manage')}
        searching={Boolean(q)}
      />
    </div>
  );
}
