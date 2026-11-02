import 'server-only';
import type { RequestMeta } from '@comprobify/core';
import { cookies, headers } from 'next/headers';

const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);

// Next sets x-forwarded-for to the socket address only when it's missing, and
// Caddy appends the client it saw, so the last entry is the real client; earlier
// entries come from the client and can be forged. Loopback means no proxy, as
// in local development, where per-IP limits are off (per-email limits stay on).
export function clientIp(source: Headers): string | null {
  const last = source.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return last && !LOOPBACK.has(last) ? last : null;
}

// The request's headers with the cookies as they are now. headers() keeps the cookies
// the request arrived with; cookies() also has those set earlier in this request, as
// when Better Auth rotates the session, so a later read sees the new session.
export async function currentHeaders(): Promise<Headers> {
  const source = new Headers(await headers());
  const jar = (await cookies()).toString();
  if (jar) source.set('cookie', jar);
  else source.delete('cookie');
  return source;
}

export async function requestMeta(): Promise<RequestMeta> {
  const source = await currentHeaders();
  return { ip: clientIp(source), headers: source };
}
