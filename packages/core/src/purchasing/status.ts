import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
  type PurchaseOrderStatus,
} from '@comprobify/db';
import { DomainError } from '../kernel';

export { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_TRANSITIONS, type PurchaseOrderStatus };

// The same rules the database trigger enforces (FR-DOC-3), checked first for a clear error.
export const canPurchaseOrderTransition = (from: PurchaseOrderStatus, to: PurchaseOrderStatus) =>
  PURCHASE_ORDER_TRANSITIONS[from].includes(to);

export function assertPurchaseOrderTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): void {
  if (!canPurchaseOrderTransition(from, to))
    throw new DomainError(
      'INVALID_TRANSITION',
      `A purchase order can not go from ${from} to ${to}`,
      {
        from,
        to,
      },
    );
}

// How an order's number is shown, on screen and on its PDF.
export const purchaseOrderNumber = (number: number) => `OC-${String(number).padStart(6, '0')}`;
