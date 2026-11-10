'use client';

import type { PaymentView } from '@comprobify/core';
import { useLocale, useTranslations } from 'next-intl';

// What a payment is for, in a few words: "Plan Negocio, mensual", "Paquete de 100 comprobantes".
export function usePaymentLabel() {
  const t = useTranslations('plan.purpose');
  const tIntervals = useTranslations('plan.intervals');
  const english = useLocale() === 'en';
  return (payment: PaymentView): string => {
    const plan = payment.targetPlan
      ? english
        ? payment.targetPlan.nameEn
        : payment.targetPlan.nameEs
      : '';
    const interval = payment.targetInterval ? tIntervals(payment.targetInterval) : '';
    switch (payment.purpose) {
      case 'INITIAL':
        return t('INITIAL', { plan, interval });
      case 'TIER_CHANGE':
        return t('TIER_CHANGE', { plan, interval });
      case 'SEAT_CHANGE':
        return t('SEAT_CHANGE', { seats: payment.targetSeats ?? 0 });
      case 'ADD_ON':
        return t('ADD_ON', {
          module: payment.targetModule
            ? english
              ? payment.targetModule.nameEn
              : payment.targetModule.nameEs
            : '',
        });
      case 'DOCUMENT_PACK':
        return t('DOCUMENT_PACK', { size: payment.packSize ?? 0 });
      default:
        return t('RENEWAL');
    }
  };
}
