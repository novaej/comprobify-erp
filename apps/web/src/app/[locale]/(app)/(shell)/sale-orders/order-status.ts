import type { SaleOrderStatus } from '@comprobify/core';
import type { Tone } from '@/components/tone-badge';

// Shared by the list and the detail (a plain module: CLAUDE.md mistake 30). Goods held for the
// client are blue, partly invoiced is amber, done is green.
export const SALE_ORDER_TONE: Record<SaleOrderStatus, Tone> = {
  DRAFT: 'neutral',
  CONFIRMED: 'info',
  PARTIALLY_INVOICED: 'warning',
  INVOICED: 'success',
  CANCELLED: 'neutral',
};
