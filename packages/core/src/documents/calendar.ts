// FR-DOC-4 and FR-DOC-5: when to try again. Pure, so fixed-clock tests cover it.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Five quick tries about five minutes apart, then hourly, spread so a whole tenant's
// failed batch doesn't hit SRI in the same second.
export const QUICK_SEND_ATTEMPTS = 5;
export const QUICK_SEND_DELAY = 5 * MINUTE;
export const SEND_SPREAD = 10 * MINUTE;

// `failures` counts the failed tries so far, this one included. Null means the next try
// would pass the deadline: the read-only check runs at the deadline instead.
export function nextSendAttempt(
  failures: number,
  now: Date,
  retryUntil: Date,
  random: () => number = Math.random,
): Date | null {
  const delay =
    failures < QUICK_SEND_ATTEMPTS ? QUICK_SEND_DELAY : HOUR + Math.floor(random() * SEND_SPREAD);
  const next = new Date(now.getTime() + delay);
  return next > retryUntil ? null : next;
}

// SRI takes up to 24 hours; most answers come within seconds.
export const QUICK_CHECK_DELAYS = [15_000, 30_000, MINUTE, 2 * MINUTE, 5 * MINUTE] as const;
export const HOURLY_CHECKS_FOR = 3 * DAY;

// `checks` counts the checks done so far. Never capped: daily after three days.
export function nextAuthorizationCheck(checks: number, receivedAt: Date, now: Date): Date {
  const quick = QUICK_CHECK_DELAYS[checks];
  if (quick !== undefined) return new Date(now.getTime() + quick);
  const hourly = now.getTime() - receivedAt.getTime() < HOURLY_CHECKS_FOR;
  return new Date(now.getTime() + (hourly ? HOUR : DAY));
}

// FR-DOC-5: SRI's maximum processing time.
export const AUTHORIZATION_OVERDUE_AFTER = DAY;
