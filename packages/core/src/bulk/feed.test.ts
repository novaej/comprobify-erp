import { describe, expect, it } from 'vitest';
import { allocateSlots, BULK_LIMITS } from './feed';

const limits = { ...BULK_LIMITS, perCompany: 3, global: 6 };
const share = (tenantId: string, inflight: number, waiting: number) => ({
  tenantId,
  inflight,
  waiting,
});
const given = (...shares: ReturnType<typeof share>[]) =>
  Object.fromEntries(allocateSlots(shares, limits));

describe('sharing the room between companies', () => {
  it('gives each company a turn, so a small company is served beside a big one', () => {
    expect(given(share('big', 0, 1000), share('small', 0, 2))).toEqual({ big: 3, small: 2 });
  });

  it('holds a company to its own room', () => {
    expect(given(share('a', 2, 10))).toEqual({ a: 1 });
    expect(given(share('a', 3, 10))).toEqual({ a: 0 });
  });

  it('stops at the global room, counting companies that only have work in flight', () => {
    expect(given(share('a', 0, 10), share('b', 0, 10), share('busy', 3, 0))).toEqual({
      a: 2,
      b: 1,
      busy: 0,
    });
    expect(given(share('a', 0, 10), share('busy', 3, 0), share('busier', 3, 0))).toEqual({
      a: 0,
      busy: 0,
      busier: 0,
    });
  });

  it('starts with the company that has the least in flight', () => {
    const shares = [share('a', 2, 5), share('b', 0, 5), share('c', 2, 5)];
    expect(Object.fromEntries(allocateSlots(shares, { ...limits, global: 8 }))).toEqual({
      a: 1,
      b: 2,
      c: 1,
    });
  });
});
