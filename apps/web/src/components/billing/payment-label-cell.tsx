'use client';

import type { PaymentView } from '@comprobify/core';
import { usePaymentLabel } from '@/components/billing/payment-label';

// The label hook in a server-rendered table.
export function PaymentLabel({ payment }: { payment: PaymentView }) {
  return <span className="font-medium">{usePaymentLabel()(payment)}</span>;
}
