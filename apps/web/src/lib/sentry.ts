import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

// What Sentry may carry, the same in the browser and on the server (ADR-008). Links carry tokens
// in their query (invitations, password resets), so a URL keeps its path only (CLAUDE.md
// mistakes 5 and 6); cookies, headers and request bodies never leave.

export const stripQuery = (url: string): string => url.replace(/[?#].*$/s, '');

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const { url, method } = event.request;
    event.request = { method, ...(url ? { url: stripQuery(url) } : {}) };
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (!crumb.data) return crumb;
  const data = { ...crumb.data };
  for (const key of ['url', 'from', 'to'])
    if (typeof data[key] === 'string') data[key] = stripQuery(data[key]);
  return { ...crumb, data };
}

// Errors only. No tracing: its spans carry every request's headers, cookies and referer, which
// beforeSend never sees. No replay, and nothing about the person beyond what the error holds.
export const sentryOptions = (dsn: string, environment: string) => ({
  dsn,
  environment,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
