import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const { clientIp } = await import('./request');

const ip = (xff?: string) => clientIp(new Headers(xff ? { 'x-forwarded-for': xff } : {}));

// FR-USR-4: the per-IP limits key on this.
describe('clientIp', () => {
  it('takes the last entry, the one the proxy added', () => {
    expect(ip('203.0.113.7')).toBe('203.0.113.7');
    expect(ip('1.1.1.1, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('ignores a forged loopback the client put first', () => {
    expect(ip('127.0.0.1, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('reports no address without a proxy', () => {
    expect(ip()).toBeNull();
    expect(ip('::1')).toBeNull();
    expect(ip('127.0.0.1')).toBeNull();
  });
});
