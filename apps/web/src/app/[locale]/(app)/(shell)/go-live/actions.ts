'use server';

import { goLive, switchOrganization } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
import { toActionState, type ActionState } from '@/server/actions';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-ONB-5. Core checks the permission; the confirmation box is checked here too.
export async function goLiveAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = form.get('locale') === 'en' ? 'en' : 'es';
  if (form.get('confirm') !== 'on') return { error: 'CONFIRM_REQUIRED' };
  const { actor, session } = await loadShell(locale);
  const { db } = await getRuntime();
  const state = await toActionState(async () => {
    const { realTenantId } = await goLive(actor, db);
    await switchOrganization(db, {
      userId: session.user.id,
      sessionId: session.sessionId,
      tenantId: realTenantId,
    });
  });
  if (state.done) {
    // The shell layout holds the badge and banners; without this the client keeps the old one.
    revalidatePath(`/${locale}`, 'layout');
    redirect({ href: '/dashboard?live=1', locale });
  }
  return state;
}
