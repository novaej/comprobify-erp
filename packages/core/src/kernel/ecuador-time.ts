// CLAUDE.md rule 15: every date decision in Ecuador time, UTC-5 all year, here only.
const OFFSET_MS = 5 * 60 * 60 * 1000;

// The instant the Ecuador calendar month containing `at` began.
export function startOfEcuadorMonth(at: Date): Date {
  const local = new Date(at.getTime() - OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + OFFSET_MS);
}

// The instant the next Ecuador calendar month begins.
export function startOfNextEcuadorMonth(at: Date): Date {
  const start = startOfEcuadorMonth(at);
  return startOfEcuadorMonth(new Date(start.getTime() + 32 * 24 * 60 * 60 * 1000));
}
