import { describe, expect, it } from 'vitest';
import { endOfEcuadorDay } from '../kernel';
import { nextAuthorizationCheck, nextSendAttempt } from './calendar';

const at = (iso: string) => new Date(iso);

describe('the sending calendar, in Ecuador time (FR-DOC-4)', () => {
  it('ends the issue day at 23:59:59.999 in Quito, month and year ends included', () => {
    expect(endOfEcuadorDay('2026-11-10').toISOString()).toBe('2026-11-11T04:59:59.999Z');
    expect(endOfEcuadorDay('2026-11-30').toISOString()).toBe('2026-12-01T04:59:59.999Z');
    expect(endOfEcuadorDay('2026-12-31').toISOString()).toBe('2027-01-01T04:59:59.999Z');
    expect(endOfEcuadorDay('2028-02-28').toISOString()).toBe('2028-02-29T04:59:59.999Z');
  });

  it('tries five times five minutes apart, then hourly with a spread', () => {
    const until = endOfEcuadorDay('2026-11-10');
    const now = at('2026-11-10T15:00:00Z');
    for (let failures = 1; failures < 5; failures++)
      expect(nextSendAttempt(failures, now, until)?.toISOString()).toBe('2026-11-10T15:05:00.000Z');
    expect(nextSendAttempt(5, now, until, () => 0)?.toISOString()).toBe('2026-11-10T16:00:00.000Z');
    expect(nextSendAttempt(5, now, until, () => 0.999)!.getTime()).toBeLessThan(
      at('2026-11-10T16:10:00Z').getTime(),
    );
  });

  it('stops at 23:59 of the issue day: a try that would pass it becomes the deadline check', () => {
    const until = endOfEcuadorDay('2026-11-30');
    // 23:56 in Quito on the last day of the month.
    const lateQuick = at('2026-12-01T04:56:00Z');
    expect(nextSendAttempt(1, lateQuick, until)).toBeNull();
    // 23:54: a quick try still fits, at 23:59.
    expect(nextSendAttempt(1, at('2026-12-01T04:54:00Z'), until)?.toISOString()).toBe(
      '2026-12-01T04:59:00.000Z',
    );
    // 23:10 with hourly tries: past midnight, so the deadline check.
    expect(nextSendAttempt(6, at('2026-12-01T04:10:00Z'), until, () => 0)).toBeNull();
  });

  it('checks authorization quickly, hourly for three days, then daily, never capped', () => {
    const received = at('2026-11-10T15:00:00Z');
    expect(nextAuthorizationCheck(0, received, received).getTime() - received.getTime()).toBe(
      15_000,
    );
    const soon = at('2026-11-10T15:10:00Z');
    expect(nextAuthorizationCheck(5, received, soon).toISOString()).toBe(
      '2026-11-10T16:10:00.000Z',
    );
    const day3 = at('2026-11-13T14:00:00Z');
    expect(nextAuthorizationCheck(80, received, day3).toISOString()).toBe(
      '2026-11-13T15:00:00.000Z',
    );
    const day4 = at('2026-11-13T15:00:01Z');
    expect(nextAuthorizationCheck(81, received, day4).toISOString()).toBe(
      '2026-11-14T15:00:01.000Z',
    );
    expect(nextAuthorizationCheck(10_000, received, at('2027-11-10T15:00:00Z'))).toBeInstanceOf(
      Date,
    );
  });
});
