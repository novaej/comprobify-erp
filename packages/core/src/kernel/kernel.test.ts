import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  DomainError,
  daysBetween,
  fixedClock,
  isDomainError,
  limitOf,
  requireFeature,
  requireWithinLimit,
  startOfEcuadorMonth,
  startOfNextEcuadorMonth,
  systemClock,
  type ActorContext,
} from './index';

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

// Rule 15: Ecuador is UTC-5 all year, so its month starts at 05:00 UTC.
describe('startOfEcuadorMonth', () => {
  it('turns the month at Ecuador midnight, not UTC midnight', () => {
    expect(startOfEcuadorMonth(new Date('2026-12-01T04:59:59Z')).toISOString()).toBe(
      '2026-11-01T05:00:00.000Z',
    );
    expect(startOfEcuadorMonth(new Date('2026-12-01T05:00:00Z')).toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
    expect(startOfEcuadorMonth(new Date('2027-01-15T12:00:00Z')).toISOString()).toBe(
      '2027-01-01T05:00:00.000Z',
    );
  });
});

describe('entitlement checks (FR-PLAN-4)', () => {
  const ctx = {
    tenantId: 't',
    tenantMode: 'TEST',
    userId: 'u',
    permissions: [],
    issuePointIds: null,
    clock: systemClock,
    entitlements: { features: ['DOC_TYPE_01'], limits: { USERS: 2, DOCUMENT_QUOTA: null } },
  } satisfies ActorContext;

  it('refuses a feature the tenant lacks with FEATURE_NOT_ENABLED', () => {
    expect(() => requireFeature(ctx, 'DOC_TYPE_01')).not.toThrow();
    expect(() => requireFeature(ctx, 'INVENTORY')).toThrow(
      expect.objectContaining({ code: 'FEATURE_NOT_ENABLED', details: { feature: 'INVENTORY' } }),
    );
  });

  it('allows up to the limit, never caps null, and treats a missing limit as 0', () => {
    expect(() => requireWithinLimit(ctx.entitlements, 'USERS', 1)).not.toThrow();
    expect(() => requireWithinLimit(ctx.entitlements, 'USERS', 2)).toThrow(
      expect.objectContaining({ code: 'LIMIT_REACHED', details: { feature: 'USERS', limit: 2 } }),
    );
    expect(() => requireWithinLimit(ctx.entitlements, 'DOCUMENT_QUOTA', 1e6)).not.toThrow();
    expect(limitOf(ctx.entitlements, 'MAX_BRANCHES')).toBe(0);
  });
});

describe('startOfNextEcuadorMonth', () => {
  it('lands on the next Ecuador month, across the year and from its last minute', () => {
    expect(startOfNextEcuadorMonth(new Date('2026-12-31T12:00:00Z')).toISOString()).toBe(
      '2027-01-01T05:00:00.000Z',
    );
    expect(startOfNextEcuadorMonth(new Date('2027-02-01T04:59:00Z')).toISOString()).toBe(
      '2027-02-01T05:00:00.000Z',
    );
  });
});

// FR-SAL-10: due dates are calendar arithmetic on plain days.
describe('calendar days', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-11-10', 30)).toBe('2026-12-10');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-10', 0)).toBe('2026-11-10');
  });

  it('adds months and holds a short month to its last day', () => {
    expect(addMonths('2026-11-10', 1)).toBe('2026-12-10');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 2)).toBe('2027-02-15');
    expect(addMonths('2026-03-31', 12)).toBe('2027-03-31');
  });

  it('counts the days between dates, negative when earlier', () => {
    expect(daysBetween('2026-11-10', '2026-12-10')).toBe(30);
    expect(daysBetween('2026-12-10', '2026-11-10')).toBe(-30);
    expect(daysBetween('2026-11-10', '2026-11-10')).toBe(0);
  });
});
