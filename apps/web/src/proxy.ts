import { loadHostEnv } from '@comprobify/config/env';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { hostRedirect } from './lib/hosts';

export const REQUEST_ID_HEADER = 'x-request-id';

const intlMiddleware = createMiddleware(routing);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Read once: the addresses don't change while the process runs (ADR-048).
const hosts = loadHostEnv();

export function proxy(req: NextRequest) {
  // The public pages on the landing host, the app on its own (ADR-048).
  const moved = hostRedirect(
    {
      host: req.headers.get('host') ?? '',
      pathname: req.nextUrl.pathname,
      search: req.nextUrl.search,
    },
    hosts,
  );
  if (moved) return NextResponse.redirect(moved, 308);
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
