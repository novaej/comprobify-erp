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

// The instant an Ecuador calendar day (YYYY-MM-DD) begins.
export function startOfEcuadorDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day) + OFFSET_MS);
}

// The Ecuador calendar day of an instant, as YYYY-MM-DD: the issue date of a document
// sent at that instant (SRI rule 6).
export function ecuadorDate(at: Date): string {
  return new Date(at.getTime() - OFFSET_MS).toISOString().slice(0, 10);
}

// An instant as Ecuador wall time with its offset, as xsd:dateTime: 2026-11-10T10:00:00-05:00.
export function ecuadorDateTime(at: Date): string {
  return `${new Date(at.getTime() - OFFSET_MS).toISOString().slice(0, 19)}-05:00`;
}

// The last instant of an Ecuador calendar day (YYYY-MM-DD): 23:59:59.999 in Quito.
export function endOfEcuadorDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1) + OFFSET_MS - 1);
}

// As printed on a RIDE: 10/11/2026 10:00:00, Quito wall time.
export function ecuadorDateTimeDisplay(at: Date): string {
  const [date, time] = ecuadorDateTime(at).split('T') as [string, string];
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year} ${time.slice(0, 8)}`;
}

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Calendar days after a YYYY-MM-DD date. Dates are plain days, so there is no time zone to get
// wrong here.
export function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  return iso(Date.UTC(year, month - 1, day + days));
}

// Calendar months after a date, held to the end of a shorter month: 31 Jan + 1 month is 28 or
// 29 Feb, never March (CLAUDE.md mistake 1).
export function addMonths(date: string, months: number): string {
  const [year, month, day] = parts(date);
  const first = Date.UTC(year, month - 1 + months, 1);
  const last = new Date(
    Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth() + 1, 0),
  );
  return iso(Math.min(first + (day - 1) * 86_400_000, last.getTime()));
}

// Whole days from one date to a later one; negative when it is earlier.
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}
