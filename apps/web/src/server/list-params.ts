import { LIST_STATUSES, type ListStatus } from '@comprobify/core';

type Raw = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

// What a list reads from its URL, each value checked against what is allowed: anything else is
// ignored, as if it had not been sent.
export function listParams<S extends string>(raw: Raw, sorts: readonly S[]) {
  const status = one(raw.status);
  const sort = one(raw.sort);
  const dir = one(raw.dir);
  const direction: 'asc' | 'desc' | undefined =
    dir === 'desc' ? 'desc' : dir === 'asc' ? 'asc' : undefined;
  return {
    query: one(raw.q)?.trim() || undefined,
    status: (LIST_STATUSES as readonly string[]).includes(status ?? '')
      ? (status as ListStatus)
      : undefined,
    sort: (sorts as readonly string[]).includes(sort ?? '') ? (sort as S) : undefined,
    direction,
    raw: (name: string) => one(raw[name]),
  };
}
