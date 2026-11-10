import { describe, expect, it } from 'vitest';
import { periodEndFrom, quotaWindow } from './periods';

describe('billing periods', () => {
  it('ends a month or a year on, clamped at the end of a short month', () => {
    expect(periodEndFrom('2026-11-10', 'MONTHLY')).toBe('2026-12-10');
    expect(periodEndFrom('2026-01-31', 'MONTHLY')).toBe('2026-02-28');
    expect(periodEndFrom('2028-01-31', 'MONTHLY')).toBe('2028-02-29');
    expect(periodEndFrom('2026-11-10', 'YEARLY')).toBe('2027-11-10');
    expect(periodEndFrom('2028-02-29', 'YEARLY')).toBe('2029-02-28');
  });
});

describe('the quota window', () => {
  it('is the billed period, whole, with twelve months of quota for a yearly one', () => {
    const period = { periodStart: '2026-11-10', periodEnd: '2027-11-10' };
    expect(quotaWindow({ ...period, interval: 'YEARLY' }, '2027-03-01')).toEqual({
      start: '2026-11-10',
      end: '2027-11-10',
      months: 12,
    });
  });

  it('stays the ended period until it is paid: no refresh for an unpaid one', () => {
    const period = {
      interval: 'MONTHLY' as const,
      periodStart: '2026-11-10',
      periodEnd: '2026-12-10',
    };
    expect(quotaWindow(period, '2026-12-15')).toEqual({
      start: '2026-11-10',
      end: '2026-12-10',
      months: 1,
    });
  });

  it('renews monthly from its anchor when nothing is billed, without drifting', () => {
    const free = { interval: 'MONTHLY' as const, periodStart: '2026-01-31', periodEnd: null };
    expect(quotaWindow(free, '2026-01-31')).toEqual({
      start: '2026-01-31',
      end: '2026-02-28',
      months: 1,
    });
    expect(quotaWindow(free, '2026-02-28')).toEqual({
      start: '2026-02-28',
      end: '2026-03-31',
      months: 1,
    });
    // From the anchor, not from the last window: March is the 31st again.
    expect(quotaWindow(free, '2026-03-30')).toEqual({
      start: '2026-02-28',
      end: '2026-03-31',
      months: 1,
    });
    expect(quotaWindow(free, '2026-03-31')).toEqual({
      start: '2026-03-31',
      end: '2026-04-30',
      months: 1,
    });
    expect(quotaWindow(free, '2027-01-15')).toEqual({
      start: '2026-12-31',
      end: '2027-01-31',
      months: 1,
    });
    expect(quotaWindow({ ...free, periodStart: '2026-11-10' }, '2026-11-09')).toEqual({
      start: '2026-11-10',
      end: '2026-12-10',
      months: 1,
    });
  });
});
