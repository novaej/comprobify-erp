import type { BatchRow, ItemView } from '@comprobify/core';
import type { Tone } from '@/components/tone-badge';

// Shared by the list and the stack view (a plain module: CLAUDE.md mistake 30).
export const ITEM_TONE: Record<ItemView, Tone> = {
  QUEUED: 'neutral',
  CREATING: 'info',
  SENT: 'warning',
  AUTHORIZED: 'success',
  FAILED: 'danger',
};

export const BATCH_TONE: Record<BatchRow['status'], Tone> = {
  PROCESSING: 'info',
  COMPLETED: 'success',
};

export const ITEM_VIEWS: ItemView[] = ['QUEUED', 'CREATING', 'SENT', 'AUTHORIZED', 'FAILED'];
