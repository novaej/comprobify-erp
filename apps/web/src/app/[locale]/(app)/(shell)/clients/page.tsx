import { CLIENT_ID_TYPES, hasFeature, listClients, SRI_TERM_UNITS } from '@comprobify/core';
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
import { ClientManager } from './client-manager';

export const generateMetadata = pageTitle('clients');

// FR-MD-2: who the company sells to. Consumidor final needs no row.
export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ locale }, { q }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'CLIENTS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('clients.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const clients = await listClients(actor, db, { query: q, includeInactive: true });
  const t = await getTranslations('clients');
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
      <ClientManager
        clients={clients.map((client) => ({
          id: client.id,
          idType: client.idType,
          identification: client.identification,
          name: client.name,
          emails: client.emails,
          phone: client.phone,
          address: client.address,
          paymentTerm: client.paymentTerm,
          paymentTermUnit: client.paymentTermUnit,
          active: client.active,
        }))}
        idTypes={CLIENT_ID_TYPES.map((code) => ({
          value: code,
          label: tSri(`idTypes.${code as '04'}`),
        }))}
        termUnits={SRI_TERM_UNITS.map((code) => ({
          value: code,
          label: tSri(`termUnits.${code}`),
        }))}
        canManage={actor.permissions.includes('clients.manage')}
        searching={Boolean(q)}
      />
    </div>
  );
}
