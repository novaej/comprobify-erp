import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent, stripQuery } from './sentry';

// ADR-008: what Sentry may carry.
describe('the Sentry scrubber', () => {
  it('keeps a URL to its path', () => {
    expect(stripQuery('https://app.comprobify.com/es/reset-password?token=abc#x')).toBe(
      'https://app.comprobify.com/es/reset-password',
    );
    expect(stripQuery('/es/dashboard')).toBe('/es/dashboard');
  });

  it('drops cookies, headers, the query and the body from an event', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://app.comprobify.com/es/invite?token=secret',
        method: 'POST',
        query_string: 'token=secret',
        cookies: { session: 'x' },
        headers: { authorization: 'Bearer y', cookie: 'session=x' },
        data: { password: 'z' },
      },
      breadcrumbs: [{ category: 'fetch', data: { url: '/api/x?code=123456', method: 'GET' } }],
    } as ErrorEvent;
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request).toEqual({
      method: 'POST',
      url: 'https://app.comprobify.com/es/invite',
    });
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({ url: '/api/x', method: 'GET' });
  });

  it('strips navigation breadcrumbs too', () => {
    const crumb = scrubBreadcrumb({
      category: 'navigation',
      data: { from: '/es/login?next=%2Fplan', to: '/es/verify?token=t' },
    });
    expect(crumb.data).toEqual({ from: '/es/login', to: '/es/verify' });
  });
});
