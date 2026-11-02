import { describe, expect, it } from 'vitest';
import { DomainError, fixedClock, isDomainError, systemClock } from './index';

describe('DomainError', () => {
  it('carries a stable code, details and cause', () => {
    const cause = new Error('db');
    const error = new DomainError(
      'FEATURE_NOT_ENABLED',
      'Off',
      { feature: 'INVENTORY' },
      { cause },
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'DomainError',
      code: 'FEATURE_NOT_ENABLED',
      details: { feature: 'INVENTORY' },
      cause,
    });
  });

  // Next bundles the class more than once; another copy carries the same brand.
  it('is recognized when thrown by another copy of the class', () => {
    const fromOtherBundle = Object.assign(new Error('Out'), {
      code: 'QUOTA_EXCEEDED',
      [Symbol.for('comprobify.DomainError')]: true,
    });
    expect(isDomainError(fromOtherBundle, 'QUOTA_EXCEEDED')).toBe(true);
    expect(isDomainError(Object.assign(new Error('x'), { code: 'QUOTA_EXCEEDED' }))).toBe(false);
  });

  it('is recognized by code', () => {
    const error = new DomainError('QUOTA_EXCEEDED', 'Out');
    expect(isDomainError(error)).toBe(true);
    expect(isDomainError(error, 'QUOTA_EXCEEDED')).toBe(true);
    expect(isDomainError(error, 'OTHER')).toBe(false);
    expect(isDomainError(new Error('x'))).toBe(false);
  });
});

describe('Clock', () => {
  it('fixedClock returns a set time and copies it', () => {
    const clock = fixedClock('2026-01-31T23:59:59-05:00');
    clock.now().setFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-02-01T04:59:59.000Z');
    clock.set('2026-02-01T00:00:00-05:00');
    expect(clock.now().toISOString()).toBe('2026-02-01T05:00:00.000Z');
  });

  it('systemClock returns the current time', () => {
    const before = Date.now();
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(before);
  });
});
