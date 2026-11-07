import type { PurchaseOrderStatus } from '@comprobify/core';
import type { Tone } from '@/components/tone-badge';

// Shared by the list and the detail (a plain module: CLAUDE.md mistake 30). Waiting on the
// provider is blue, partly in is amber, done is green.
export const ORDER_TONE: Record<PurchaseOrderStatus, Tone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
};
