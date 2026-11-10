import type { PaymentView } from '@comprobify/core';
import type { Tone } from '@/components/tone-badge';

// Shared by the server table and the client card: a plain module (CLAUDE.md mistake 30).
export const STATUS_TONE: Record<PaymentView['status'], Tone> = {
  PENDING: 'warning',
  REPORTED: 'info',
  REJECTED: 'danger',
  VERIFIED: 'success',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
};
