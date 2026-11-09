import { SALE_ORDER_STATUSES, SALE_ORDER_TRANSITIONS, type SaleOrderStatus } from '@comprobify/db';
import { DomainError } from '../kernel';

export { SALE_ORDER_STATUSES, SALE_ORDER_TRANSITIONS, type SaleOrderStatus };

// The same rules the database trigger enforces (FR-DOC-3), checked first for a clear error.
export const canSaleOrderTransition = (from: SaleOrderStatus, to: SaleOrderStatus) =>
  SALE_ORDER_TRANSITIONS[from].includes(to);

export function assertSaleOrderTransition(from: SaleOrderStatus, to: SaleOrderStatus): void {
  if (!canSaleOrderTransition(from, to))
    throw new DomainError('INVALID_TRANSITION', `A sale order can not go from ${from} to ${to}`, {
      from,
      to,
    });
}

// How an order's number is shown.
export const saleOrderNumber = (number: number) => `PV-${String(number).padStart(6, '0')}`;
