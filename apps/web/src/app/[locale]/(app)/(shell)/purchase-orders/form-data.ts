import 'server-only';
import {
  ecuadorDate,
  hasFeature,
  ivaPercent,
  listProducts,
  listProviders,
  orderWarehouses,
  systemClock,
  type ActorContext,
} from '@comprobify/core';
import type { Database } from '@comprobify/db';
import { getTranslations } from 'next-intl/server';
import type { OrderProductOption, OrderProviderOption } from './order-form';

// What the order form offers: active providers, active products and warehouses.
export async function orderFormData(actor: ActorContext, db: Database) {
  const tSri = await getTranslations('sri');
  const canProducts = hasFeature(actor, 'CATALOG') && actor.permissions.includes('catalog.read');
  const [providers, products, warehouses] = await Promise.all([
    listProviders(actor, db),
    canProducts ? listProducts(actor, db) : [],
    orderWarehouses(actor, db),
  ]);
  return {
    today: ecuadorDate(systemClock.now()),
    providers: providers.map((provider): OrderProviderOption => ({
      id: provider.id,
      name: provider.name,
      identification: provider.identification,
      idTypeLabel: tSri(`idTypes.${provider.idType as '04'}`),
    })),
    products: products
      .filter((product) => product.active)
      .map((product): OrderProductOption => ({
        id: product.id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        cost: product.cost,
        ivaRateCode: product.ivaRateCode,
        ivaPercent: ivaPercent(product.ivaRateCode).toString(),
        ivaLabel: tSri(`ivaRates.${product.ivaRateCode as '4'}`),
      })),
    warehouses: warehouses.map((warehouse) => ({
      value: warehouse.id,
      label: `${warehouse.branchCode} ${warehouse.name}`,
    })),
  };
}
