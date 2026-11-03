import 'server-only';
import {
  certificateStatus,
  chooseActiveOrganization,
  isDomainError,
  listOrganizations,
  recordSessionStart,
  resolveActor,
  systemClock,
} from '@comprobify/core';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation';
import { getRuntime } from './runtime';
import { requireSession } from './session';

// Everything the shell and its pages need, once per request.
export const loadShell = cache(async (locale: string) => {
  const session = await requireSession(locale);
  const { db } = await getRuntime();
  const organizations = await listOrganizations(db, session.user.id);
  const active = chooseActiveOrganization(organizations, session.activeTenantId);
  // A platform account usually has no company of its own; onboarding stays a link away.
  if (!active)
    return redirect({ href: session.user.isSuperAdmin ? '/admin' : '/onboarding', locale });
  // FR-USR-3: the organization requires TOTP, so set it up before working there.
  if (active.entry.requireTwoFactor && !session.user.twoFactorEnabled) {
    return redirect({ href: '/account?twoFactorRequired=1', locale });
  }

  try {
    const actor = await resolveActor(db, {
      userId: session.user.id,
      tenantId: active.tenantId,
      clock: systemClock,
    });
    const certificate = await certificateStatus(db, actor);
    // FR-NOT-4: once per session and company, however many pages it opens.
    await recordSessionStart(db, {
      tenantId: active.tenantId,
      userId: session.user.id,
      sessionId: session.sessionId,
    });
    return { session, organizations, active, actor, certificate };
  } catch (error) {
    // Removed since the list was read: start over without it.
    if (isDomainError(error, 'NOT_A_MEMBER')) return redirect({ href: '/dashboard', locale });
    throw error;
  }
});
