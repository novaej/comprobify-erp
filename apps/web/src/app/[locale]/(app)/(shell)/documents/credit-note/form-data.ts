import 'server-only';
import { creditBalance, issuingOptions, SRI_IVA_RATES, type ActorContext } from '@comprobify/core';
import { getTranslations } from 'next-intl/server';
import { getRuntime } from '@/server/runtime';

// What the nota de crédito form offers: the invoice's remaining balance per line, and the
// issue points enabled for the type. Throws core's refusal if the invoice can't be credited.
export async function creditFormData(actor: ActorContext, originId: string) {
  const { db } = await getRuntime();
  const [options, balance, tSri] = await Promise.all([
    issuingOptions(actor, db, '04'),
    creditBalance(actor, db, originId),
    getTranslations('sri'),
  ]);
  return {
    issuePoints: options.issuePoints.map((point) => ({
      value: point.id,
      label: `${point.code} ${point.branchName}`,
    })),
    canReturnStock: balance.canReturnStock,
    balance: balance.lines.map((line) => ({
      position: line.position,
      code: line.code,
      name: line.name,
      ivaRateCode: line.ivaRateCode,
      ivaLabel: tSri(`ivaRates.${line.ivaRateCode as '4'}`),
      unitPrice: line.unitPrice,
      remainingQuantity: line.remainingQuantity,
      remainingBase: line.remainingBase,
    })),
    percents: Object.fromEntries(SRI_IVA_RATES.map((rate) => [rate.code, rate.percent])),
  };
}
