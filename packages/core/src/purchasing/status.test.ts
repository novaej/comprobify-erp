import { describe, expect, it } from 'vitest';
import {
  assertPurchaseOrderTransition,
  canPurchaseOrderTransition,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
  purchaseOrderNumber,
} from './index';

// FR-PUR-1, FR-DOC-3.
describe('purchase order status', () => {
  it('follows the order from draft to closed', () => {
    expect(canPurchaseOrderTransition('DRAFT', 'SENT')).toBe(true);
    expect(canPurchaseOrderTransition('SENT', 'PARTIALLY_RECEIVED')).toBe(true);
    expect(canPurchaseOrderTransition('PARTIALLY_RECEIVED', 'RECEIVED')).toBe(true);
    expect(canPurchaseOrderTransition('RECEIVED', 'CLOSED')).toBe(true);
  });

  it('cancels only before anything arrives', () => {
    expect(canPurchaseOrderTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(canPurchaseOrderTransition('SENT', 'CANCELLED')).toBe(true);
    expect(canPurchaseOrderTransition('PARTIALLY_RECEIVED', 'CANCELLED')).toBe(false);
    expect(canPurchaseOrderTransition('RECEIVED', 'CANCELLED')).toBe(false);
  });

  it('never receives a draft, and ends at closed or cancelled', () => {
    expect(canPurchaseOrderTransition('DRAFT', 'RECEIVED')).toBe(false);
    expect(PURCHASE_ORDER_TRANSITIONS.CLOSED).toEqual([]);
    expect(PURCHASE_ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    expect(() => assertPurchaseOrderTransition('CLOSED', 'SENT')).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('lists every status once, each with its transitions', () => {
    expect(Object.keys(PURCHASE_ORDER_TRANSITIONS).sort()).toEqual(
      [...PURCHASE_ORDER_STATUSES].sort(),
    );
  });

  it('shows the number with its prefix', () => {
    expect(purchaseOrderNumber(42)).toBe('OC-000042');
  });
});
