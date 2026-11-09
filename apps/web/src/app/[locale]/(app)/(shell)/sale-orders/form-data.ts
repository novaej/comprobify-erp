import 'server-only';
import {
  ecuadorDate,
  hasFeature,
  ivaPercent,
  listClients,
  listProducts,
  saleOrderWarehouses,
  systemClock,
  type ActorContext,
} from '@comprobify/core';
import type { Database } from '@comprobify/db';
import { getTranslations } from 'next-intl/server';
import type { OrderClientOption, OrderProductOption } from './order-form';

// What the order form offers: active clients, active products and warehouses.
export async function orderFormData(actor: ActorContext, db: Database) {
  const tSri = await getTranslations('sri');
  const canProducts = hasFeature(actor, 'CATALOG') && actor.permissions.includes('catalog.read');
  const canClients = hasFeature(actor, 'CLIENTS') && actor.permissions.includes('clients.read');
  const [clients, products, warehouses] = await Promise.all([
    canClients ? listClients(actor, db) : [],
    canProducts ? listProducts(actor, db) : [],
    saleOrderWarehouses(actor, db),
  ]);
  return {
    today: ecuadorDate(systemClock.now()),
    clients: clients.map((client): OrderClientOption => ({
      id: client.id,
      name: client.name,
      identification: client.identification,
      idTypeLabel: tSri(`idTypes.${client.idType as '05'}`),
    })),
    products: products
      .filter((product) => product.active)
      .map((product): OrderProductOption => ({
        id: product.id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        price: product.price,
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
