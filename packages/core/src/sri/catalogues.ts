import {
  CONSUMER_FINAL_ID,
  SRI_DOCUMENT_TYPES,
  SRI_ID_TYPES,
  SRI_IVA_RATES,
  SRI_PAYMENT_METHODS,
  SRI_TAX_CODES,
  SRI_TERM_UNITS,
} from '@comprobify/db';
import { Dec } from '../kernel';

export {
  CONSUMER_FINAL_ID,
  SRI_DOCUMENT_TYPES,
  SRI_ID_TYPES,
  SRI_IVA_RATES,
  SRI_PAYMENT_METHODS,
  SRI_TAX_CODES,
  SRI_TERM_UNITS,
};

export type SriDocumentType = (typeof SRI_DOCUMENT_TYPES)[number];
export type SriIdType = (typeof SRI_ID_TYPES)[number];
export type IvaRateCode = (typeof SRI_IVA_RATES)[number]['code'];
export type PaymentMethod = (typeof SRI_PAYMENT_METHODS)[number];

export const IVA_TAX_CODE = '2';
export const CONSUMER_FINAL_ID_TYPE = '07';

// The rates a product can carry today (ADR-012).
export const SELECTABLE_IVA_RATES = SRI_IVA_RATES.filter((rate) => rate.selectable).map(
  (rate) => rate.code,
);

export function ivaPercent(code: string): Dec {
  const rate = SRI_IVA_RATES.find((row) => row.code === code);
  if (!rate) throw new Error(`Unknown IVA rate code ${code}`);
  return new Dec(rate.percent);
}
