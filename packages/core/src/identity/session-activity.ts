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

// FR-USR-3: a device the user chose to remember skips the code at sign-in for this long, renewed
// each time it is used (ADR-045).
export const TRUSTED_DEVICE_SECONDS = 30 * 24 * 60 * 60;
