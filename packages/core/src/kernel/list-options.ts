import { asc, desc, eq, sql, type AnyColumn, type SQL } from '@comprobify/db';

// What the master-data lists (clients, products, providers) take besides a search: which
// records by state, and the order. The screens give these from the URL, so every value is
// checked against what is allowed here and anything else is ignored.
export const LIST_STATUSES = ['active', 'inactive', 'all'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];
export type ListDirection = 'asc' | 'desc';

export type StateOptions = { status?: ListStatus; includeInactive?: boolean };

// `includeInactive` is the older switch: with no status it means "all", without it "active".
export function stateCondition(active: AnyColumn, options: StateOptions): SQL | undefined {
  const status = options.status ?? (options.includeInactive ? 'all' : 'active');
  if (status === 'all') return undefined;
  return eq(active, status === 'active');
}

// A chosen column first, then the name so equal values stay in a steady order. With none chosen:
// active ones first, by name, as before.
export function listOrder(
  active: AnyColumn,
  name: AnyColumn,
  columns: Record<string, AnyColumn>,
  sort?: string,
  direction: ListDirection = 'asc',
): SQL[] {
  const column = sort ? columns[sort] : undefined;
  if (!column) return [sql`${active} DESC`, asc(name)];
  return [direction === 'desc' ? desc(column) : asc(column), asc(name)];
}
