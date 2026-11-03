// CLAUDE.md rule 15: every date decision in Ecuador time, UTC-5 all year, here only.
const OFFSET_MS = 5 * 60 * 60 * 1000;

// The instant the Ecuador calendar month containing `at` began.
export function startOfEcuadorMonth(at: Date): Date {
  const local = new Date(at.getTime() - OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + OFFSET_MS);
}
