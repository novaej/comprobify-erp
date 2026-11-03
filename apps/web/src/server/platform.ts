import 'server-only';
import { isDomainError, resolvePlatformActor, systemClock } from '@comprobify/core';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation';
import { getRuntime } from './runtime';
import { requireSession } from './session';

// The super admin area (ADR-010): no tenant, and core checks the flag again on
// every call. Anyone else gets a 404, so the area isn't advertised.
export const loadPlatform = cache(async (locale: string) => {
  const session = await requireSession(locale);
  const { db } = await getRuntime();
  try {
    const actor = await resolvePlatformActor(db.identity, {
      userId: session.user.id,
      clock: systemClock,
    });
    // It can change any company's plan, so a password alone isn't enough.
    if (!session.user.twoFactorEnabled)
      return redirect({ href: '/account?twoFactorRequired=admin', locale });
    return { session, actor };
  } catch (error) {
    if (isDomainError(error, 'FORBIDDEN')) notFound();
    throw error;
  }
});
