import { and, or, sql, type SQL } from '@comprobify/db';
import { z } from 'zod';

// NFR-PERF-4: lists on large tables page by keyset, never OFFSET. A page is read from just after
// (or before) the row a cursor names, so page 500 costs what page 1 does. The order always ends in
// a unique column (the id), so no two rows tie and none is skipped or shown twice.

export type KeysetColumn = { expr: SQL; direction: 'asc' | 'desc' };
// A cursor is the ordered values of the row it points at. Opaque to the screens.
export type CursorValue = string | number;

export const cursorInput = z.string().trim().max(2_000).optional();

export function encodeCursor(values: CursorValue[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

// A cursor from the URL: anything that isn't one of ours, or has the wrong shape, reads as none,
// which is the first page.
export function decodeCursor(text: string | undefined, size: number): CursorValue[] | null {
  if (!text) return null;
  try {
    const values: unknown = JSON.parse(Buffer.from(text, 'base64url').toString());
    return Array.isArray(values) &&
      values.length === size &&
      values.every((value) => typeof value === 'string' || typeof value === 'number')
      ? values
      : null;
  } catch {
    return null;
  }
}

// Rows strictly past `values` in `columns`' order (or before them, going back), as
// (a > x) OR (a = x AND b > y) OR …, which works whatever mix of directions the columns have.
function past(columns: KeysetColumn[], values: CursorValue[], forward: boolean): SQL {
  const after = (column: KeysetColumn) => (column.direction === 'asc') === forward;
  const branches = columns.map((column, index) =>
    and(
      ...columns.slice(0, index).map((earlier, i) => sql`${earlier.expr} = ${values[i]}`),
      after(column)
        ? sql`${column.expr} > ${values[index]}`
        : sql`${column.expr} < ${values[index]}`,
    ),
  );
  return or(...branches)!;
}

export type KeysetRequest = { after?: string | undefined; before?: string | undefined };
export type KeysetPage<T> = { rows: T[]; next: string | null; previous: string | null };

// Reads one page: `read` gets the extra condition, the order and how many rows to take, and
// returns them with the values each row's cursor is made of.
export async function keysetPage<T>(
  columns: KeysetColumn[],
  request: KeysetRequest,
  size: number,
  read: (seek: SQL | undefined, order: SQL[], limit: number) => Promise<T[]>,
  valuesOf: (row: T) => CursorValue[],
): Promise<KeysetPage<T>> {
  const after = decodeCursor(request.after, columns.length);
  const before = after ? null : decodeCursor(request.before, columns.length);
  const backward = before !== null;
  // Going back reads in the reverse order, then turns the page round.
  const order = columns.map(({ expr, direction }) =>
    (direction === 'asc') !== backward ? sql`${expr} ASC` : sql`${expr} DESC`,
  );
  const from = after ?? before;
  const found = await read(from ? past(columns, from, !backward) : undefined, order, size + 1);
  const more = found.length > size;
  const page = found.slice(0, size);
  if (backward) page.reverse();
  const first = page[0];
  const last = page.at(-1);
  return {
    rows: page,
    // Forward: another page if more were found; back from a cursor, the page it came from.
    next: last && (backward || more) ? encodeCursor(valuesOf(last)) : null,
    // Back: another page if more were found; forward from a cursor, the pages before it.
    previous: first && (backward ? more : from !== null) ? encodeCursor(valuesOf(first)) : null,
  };
}
