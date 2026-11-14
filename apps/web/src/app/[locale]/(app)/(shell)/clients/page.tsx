import {
  CLIENT_ID_TYPES,
  CLIENT_SORTS,
  hasFeature,
  listClients,
  SRI_TERM_UNITS,
} from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { Download } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FeatureLocked } from '@/components/feature-locked';
import { ListToolbar } from '@/components/list-toolbar';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { listParams } from '@/server/list-params';
import { pageTitle } from '@/server/page-title';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { ClientManager } from './client-manager';
import { ImportClients } from './import-clients';

export const generateMetadata = pageTitle('clients');

// FR-MD-2: who the company sells to. Consumidor final needs no row.
export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  const list = listParams(raw, CLIENT_SORTS);
  const idTypeParam = list.raw('idType');
  const idType = (CLIENT_ID_TYPES as readonly string[]).includes(idTypeParam ?? '')
    ? idTypeParam
    : undefined;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'CLIENTS')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('clients.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const clients = await listClients(actor, db, {
    query: list.query,
    status: list.status ?? 'all',
    idType,
    sort: list.sort,
    direction: list.direction,
  });
  const tList = await getTranslations('listToolbar');
  const t = await getTranslations('clients');
  const tSri = await getTranslations('sri');

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          <>
            {/* A file download, not a page: a plain link to the route. */}
            <a
              href={`/${locale}/clients/csv`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              {t('export')}
            </a>
            {actor.permissions.includes('clients.manage') && <ImportClients />}
          </>
        }
      />
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
        searching={Boolean(list.query || list.status || idType)}
        sorting={{
          path: '/clients',
          query: { q: list.query, status: list.status, idType },
          sort: list.sort,
          direction: list.direction,
        }}
      />
    </div>
  );
}
