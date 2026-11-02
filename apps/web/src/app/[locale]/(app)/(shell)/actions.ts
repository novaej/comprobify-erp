'use server';

import { switchOrganization } from '@comprobify/core';
import { getRuntime } from '@/server/runtime';
import { getSession } from '@/server/session';

// The switcher (FR-USR-5). Core checks the membership.
export async function switchOrganizationAction(tenantId: string): Promise<void> {
  const session = await getSession();
  if (session.status !== 'active') return;
  const { db } = await getRuntime();
  await switchOrganization(db, { userId: session.user.id, sessionId: session.sessionId, tenantId });
}
