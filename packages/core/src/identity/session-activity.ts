// FR-USR-2. Defaults carried over from the old web app.
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
export const MIN_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_IDLE_TIMEOUT_MINUTES = 480;
// Absolute lifetime: a session ends after this however active it is.
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export function isIdle(lastActivityAt: Date, idleMinutes: number, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() > idleMinutes * 60_000;
}

export function isValidIdleTimeout(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= MIN_IDLE_TIMEOUT_MINUTES &&
    minutes <= MAX_IDLE_TIMEOUT_MINUTES
  );
}
