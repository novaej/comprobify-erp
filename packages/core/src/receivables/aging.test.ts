import { describe, expect, it } from 'vitest';
import { bucketOf } from './aging';

// FR-SAL-10: the buckets are by days past the due date.
describe('aging buckets', () => {
  it('puts not-yet-due and due-today invoices in CURRENT', () => {
    expect(bucketOf(-5)).toBe('CURRENT');
    expect(bucketOf(0)).toBe('CURRENT');
  });

  it('puts the late ones by how late', () => {
    expect([1, 30, 31, 60, 61, 90, 91, 400].map(bucketOf)).toEqual([
      'D1_30',
      'D1_30',
      'D31_60',
      'D31_60',
      'D61_90',
      'D61_90',
      'D90_PLUS',
      'D90_PLUS',
    ]);
  });
});
