import 'server-only';
import {
  hasFeature,
  issuingOptions,
  listClients,
  listProducts,
  SRI_PAYMENT_METHODS,
  SRI_TERM_UNITS,
  type ActorContext,
} from '@comprobify/core';
import { getTranslations } from 'next-intl/server';
import { getRuntime } from '@/server/runtime';

// What the invoice form offers, for a new invoice and for a correction. Pickers only for
// what the plan and role allow; free-text lines and consumidor final need neither.
export async function invoiceFormData(actor: ActorContext) {
  const { db, env } = await getRuntime();
  const options = await issuingOptions(actor, db);
  const canProducts = hasFeature(actor, 'CATALOG') && actor.permissions.includes('catalog.read');
  const canClients = hasFeature(actor, 'CLIENTS') && actor.permissions.includes('clients.read');
  const [products, clients] = await Promise.all([
    canProducts ? listProducts(actor, db) : [],
    canClients ? listClients(actor, db) : [],
  ]);
  const tSri = await getTranslations('sri');
  return {
    issuePoints: options.issuePoints.map((point) => ({
      value: point.id,
      label: `${point.code} ${point.branchName}`,
    })),
    ivaRates: options.ivaRates.map((rate) => ({
      value: rate.code,
      percent: rate.percent,
      label: tSri(`ivaRates.${rate.code as '4'}`),
    })),
    defaultIvaRate: options.ivaRates.some((rate) => rate.code === '4')
      ? '4'
      : (options.ivaRates[0]?.code ?? '0'),
    products: products.map((product) => ({
      id: product.id,
      code: product.code,
      auxiliaryCode: product.auxiliaryCode,
      name: product.name,
      unit: product.unit,
      price: product.price,
      ivaRateCode: product.ivaRateCode,
    })),
    clients: clients.map((client) => ({
      id: client.id,
      idTypeLabel: tSri(`idTypes.${client.idType as '04'}`),
      identification: client.identification,
      name: client.name,
      emails: client.emails,
      phone: client.phone,
      address: client.address,
    })),
    paymentMethods: SRI_PAYMENT_METHODS.map((code) => ({
      value: code,
      label: tSri(`paymentMethods.${code}`),
    })),
    termUnits: SRI_TERM_UNITS.map((code) => ({ value: code, label: tSri(`termUnits.${code}`) })),
    consumerFinalMax: env.CONSUMER_FINAL_MAX_AMOUNT,
    canEditClient: canClients && actor.permissions.includes('clients.manage'),
  };
}
