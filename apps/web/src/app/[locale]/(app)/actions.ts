'use server';

import { headers } from 'next/headers';
import { redirect } from '@/i18n/navigation';
import { requestMeta } from '@/server/request';
import { getRuntime } from '@/server/runtime';

const localeOf = (form: FormData): 'es' | 'en' => (form.get('locale') === 'en' ? 'en' : 'es');

export async function signOutAction(form: FormData): Promise<void> {
  const { identity } = await getRuntime();
  await identity.signOut(await requestMeta());
  redirect({ href: '/login', locale: localeOf(form) });
}

export async function signOutEverywhereAction(form: FormData): Promise<void> {
  const { identity } = await getRuntime();
  await identity.signOutEverywhere(await requestMeta());
  redirect({ href: '/login', locale: localeOf(form) });
}

// Sent by ActivityTracker on real input only (FR-USR-2).
export async function recordActivityAction(): Promise<void> {
  const { identity } = await getRuntime();
  await identity.recordActivity(new Headers(await headers()));
}
