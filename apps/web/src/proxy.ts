import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

export const REQUEST_ID_HEADER = 'x-request-id';

const intlMiddleware = createMiddleware(routing);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function proxy(req: NextRequest) {
  // Keep an id set by the edge proxy, but only if it is a UUID: it lands in logs.
  const incoming = req.headers.get(REQUEST_ID_HEADER);
  const requestId = incoming && UUID.test(incoming) ? incoming : crypto.randomUUID();
  // Set before next-intl clones the headers, so the page sees it too.
  req.headers.set(REQUEST_ID_HEADER, requestId);
  const response = intlMiddleware(req);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ['/((?!api|health|_next/static|_next/image|favicon.ico|icon|.*\\..*).*)'],
};
