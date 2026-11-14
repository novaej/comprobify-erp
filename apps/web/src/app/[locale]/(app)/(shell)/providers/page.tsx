import {
  CLIENT_ID_TYPES,
  hasFeature,
  listProviders,
  PROVIDER_SORTS,
  SRI_TERM_UNITS,
} from '@comprobify/core';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FeatureLocked } from '@/components/feature-locked';
import { ListToolbar } from '@/components/list-toolbar';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { listParams } from '@/server/list-params';
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  const list = listParams(raw, PROVIDER_SORTS);
  const idTypeParam = list.raw('idType');
  const idType = (CLIENT_ID_TYPES as readonly string[]).includes(idTypeParam ?? '')
    ? idTypeParam
    : undefined;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'PROVIDERS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('purchasing.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const providers = await listProviders(actor, db, {
    query: list.query,
    status: list.status ?? 'all',
    idType,
    sort: list.sort,
    direction: list.direction,
  });
  const tList = await getTranslations('listToolbar');
  const t = await getTranslations('providers');
  const tSri = await getTranslations('sri');

  return (
    <div className="max-w-6xl">
      <PageHeader title={t('title')} description={t('description')} />
      <ListToolbar
        searchLabel={t('search')}
        query={list.query ?? ''}
        filters={[
          {
            param: 'status',
            label: tList('status'),
            all: 'all',
            value: list.status ?? 'all',
            options: [
              { value: 'all', label: tList('allStatuses') },
              { value: 'active', label: tList('active') },
              { value: 'inactive', label: tList('inactive') },
            ],
          },
          {
            param: 'idType',
            label: tList('idType'),
            all: 'all',
            value: idType ?? 'all',
            options: [
              { value: 'all', label: tList('allIdTypes') },
              ...CLIENT_ID_TYPES.map((code) => ({
                value: code,
                label: tSri(`idTypes.${code as '04'}`),
              })),
            ],
          },
        ]}
      />
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
        searching={Boolean(list.query || list.status || idType)}
        sorting={{
          path: '/providers',
          query: { q: list.query, status: list.status, idType },
          sort: list.sort,
          direction: list.direction,
        }}
      />
    </div>
  );
}
