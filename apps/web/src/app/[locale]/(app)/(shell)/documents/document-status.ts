import type { DocumentStatus } from '@comprobify/core';
import type { Tone } from '@/components/tone-badge';

// How each status reads, shared by the list and the detail (a plain module: CLAUDE.md
// mistake 30). Done is green, waiting on SRI is blue, needs a person is red or amber.
export const STATUS_TONE: Record<DocumentStatus, Tone> = {
  SIGNED: 'info',
  PENDING_SEND: 'info',
  RECEIVED: 'info',
  RETURNED: 'danger',
  SEND_FAILED: 'warning',
  AUTHORIZED: 'success',
  NOT_AUTHORIZED: 'danger',
  VOIDED: 'neutral',
};
