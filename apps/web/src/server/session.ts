import 'server-only';
import type { SessionState } from '@comprobify/core';
import { headers } from 'next/headers';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation';
import { getRuntime } from './runtime';

// Once per request: reading the session never extends it (FR-USR-2).
export const getSession = cache(async (): Promise<SessionState> => {
  const { identity } = await getRuntime();
  return identity.currentSession(new Headers(await headers()));
});

export async function requireSession(locale: string) {
  const session = await getSession();
  if (session.status === 'active') return session;
  const href = session.status === 'idle' ? '/login?reason=idle' : '/login';
  return redirect({ href, locale });
}
