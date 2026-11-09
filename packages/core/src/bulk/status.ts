import type { BatchItemStatus, DocumentStatus } from '@comprobify/db';

// FR-BULK-2 (ADR-026). The stack view's status for an item: what the batch did with it until
// the invoice exists, then SRI's answer, read from the document rather than copied.
export type ItemView = 'QUEUED' | 'CREATING' | 'SENT' | 'AUTHORIZED' | 'FAILED';

// A document with one of these has its final answer from SRI (or was voided after it); until a
// person corrects a rejected one, nothing more happens to it. The others still move on.
export const FINAL_DOCUMENT_STATUSES = [
  'AUTHORIZED',
  'VOIDED',
  'RETURNED',
  'NOT_AUTHORIZED',
] as const satisfies readonly DocumentStatus[];

export function itemView(item: BatchItemStatus, document: DocumentStatus | null): ItemView {
  if (item !== 'CREATED' || !document) return item === 'CREATED' ? 'SENT' : item;
  if (document === 'AUTHORIZED' || document === 'VOIDED') return 'AUTHORIZED';
  if (document === 'RETURNED' || document === 'NOT_AUTHORIZED') return 'FAILED';
  return 'SENT';
}
