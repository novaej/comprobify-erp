import type { BillingInterval } from '@comprobify/db';
import { addMonths } from '../kernel';

// FR-BILL-1, FR-BILL-7 (ADR-028): billing periods and the quota window, as pure functions.

export const MONTHS_IN: Record<BillingInterval, number> = { MONTHLY: 1, YEARLY: 12 };

// The end of a period that starts on `start`: a month or a year on, clamped at the month's end
// (31 January + 1 month is 28 or 29 February). Always from the previous period's end, never from
// "now", so a late or early payment can't move the billing day (Appendix B lesson 1).
export function periodEndFrom(start: string, interval: BillingInterval): string {
  return addMonths(start, MONTHS_IN[interval]);
}

export type SubscriptionPeriod = {
  interval: BillingInterval;
  periodStart: string;
  // Null: not billed (a free plan or complimentary).
  periodEnd: string | null;
};

// The window the document quota counts in, and how many months of quota it holds.
// A billed period is the window, whole: a yearly one pools twelve months up front (ADR-029 of
// the old system, kept). After it ends and before it is renewed, it stays the window: the quota
// never refreshes for a period nobody paid. With no billed period, the quota renews every month
// from the day the subscription's period started, each window counted from that anchor so the
// day never drifts.
export function quotaWindow(
  period: SubscriptionPeriod,
  today: string,
): { start: string; end: string; months: number } {
  if (period.periodEnd !== null)
    return {
      start: period.periodStart,
      end: period.periodEnd,
      months: MONTHS_IN[period.interval],
    };
  const anchor = period.periodStart;
  if (today < anchor) return { start: anchor, end: addMonths(anchor, 1), months: 1 };
  const [ay, am] = anchor.split('-').map(Number) as [number, number];
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  let k = (ty - ay) * 12 + (tm - am);
  if (addMonths(anchor, k) > today) k -= 1;
  return { start: addMonths(anchor, k), end: addMonths(anchor, k + 1), months: 1 };
}
