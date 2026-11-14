import {
  hasFeature,
  listProducts,
  PRODUCT_KINDS,
  PRODUCT_SORTS,
  SELECTABLE_IVA_RATES,
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
import { ImportProducts } from './import-products';
import { ProductManager } from './product-manager';

export const generateMetadata = pageTitle('products');

// FR-MD-1: what the company sells, with the IVA each line will carry.
export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  const list = listParams(raw, PRODUCT_SORTS);
  const kindParam = list.raw('kind');
  const kind = PRODUCT_KINDS.find((value) => value === kindParam);
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!hasFeature(actor, 'CATALOG')) return <FeatureLocked actor={actor} />;
  if (!actor.permissions.includes('catalog.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const products = await listProducts(actor, db, {
    query: list.query,
    status: list.status ?? 'all',
    kind,
    sort: list.sort,
    direction: list.direction,
  });
  const tList = await getTranslations('listToolbar');
  const t = await getTranslations('products');
  const tSri = await getTranslations('sri');
  const price = new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  const ivaLabel = (code: string) => tSri(`ivaRates.${code as '4'}`);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          <>
            {/* A file download, not a page: a plain link to the route. */}
            <a
              href={`/${locale}/products/csv`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              {t('export')}
            </a>
            {actor.permissions.includes('catalog.manage') && <ImportProducts />}
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
            param: 'kind',
            label: tList('kind'),
            all: 'all',
            value: kind ?? 'all',
            options: [
              { value: 'all', label: tList('allKinds') },
              ...PRODUCT_KINDS.map((value) => ({ value, label: t(`kinds.${value}`) })),
            ],
          },
        ]}
      />
      <ProductManager
        products={products.map((product) => ({
          id: product.id,
          code: product.code,
          auxiliaryCode: product.auxiliaryCode,
          name: product.name,
          description: product.description,
          kind: product.kind,
          unit: product.unit,
          // Trailing zeros off for editing; the exact decimal stays a string (ADR-012).
          price: product.price.replace(/\.?0+$/, ''),
          // Formatted from the decimal string itself, never through a float (ADR-012).
          priceShown: price.format(product.price as Intl.StringNumericLiteral),
          cost: product.cost?.replace(/\.?0+$/, '') ?? null,
          ivaRateCode: product.ivaRateCode,
          ivaLabel: ivaLabel(product.ivaRateCode),
          tracksStock: product.tracksStock,
          additionalDetails: product.additionalDetails,
          active: product.active,
        }))}
        kinds={PRODUCT_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))}
        ivaRates={SELECTABLE_IVA_RATES.map((code) => ({ value: code, label: ivaLabel(code) }))}
        canManage={actor.permissions.includes('catalog.manage')}
        searching={Boolean(list.query || list.status || kind)}
        sorting={{
          path: '/products',
          query: { q: list.query, status: list.status, kind },
          sort: list.sort,
          direction: list.direction,
        }}
      />
    </div>
  );
}
