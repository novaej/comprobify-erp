import 'server-only';
import {
  issuingOptions,
  SRI_IVA_RATES,
  SRI_PAYMENT_METHODS,
  SRI_TERM_UNITS,
  type ActorContext,
} from '@comprobify/core';
import { getTranslations } from 'next-intl/server';
import { getRuntime } from '@/server/runtime';
import type { OrderLineOption } from './[id]/invoice/order-invoice-form';

// What the order's invoice form offers, for a new invoice and for a correction.
export async function orderInvoiceFormData(
  actor: ActorContext,
  lines: {
    orderLineId: string;
    code: string;
    name: string;
    unit: string | null;
    unitPrice: string;
    discount: string;
    quantity: string;
    ivaRateCode: string;
    left: string;
    current: string;
  }[],
) {
  const { db } = await getRuntime();
  const [options, tSri] = await Promise.all([issuingOptions(actor, db), getTranslations('sri')]);
  return {
    issuePoints: options.issuePoints.map((point) => ({
      value: point.id,
      label: `${point.code} ${point.branchName}`,
    })),
    lines: lines.map((line): OrderLineOption => ({
      ...line,
      ivaLabel: tSri(`ivaRates.${line.ivaRateCode as '4'}`),
    })),
    percents: Object.fromEntries(SRI_IVA_RATES.map((rate) => [rate.code, rate.percent])),
    paymentMethods: SRI_PAYMENT_METHODS.map((code) => ({
      value: code,
      label: tSri(`paymentMethods.${code}`),
    })),
    termUnits: SRI_TERM_UNITS.map((code) => ({ value: code, label: tSri(`termUnits.${code}`) })),
  };
}
