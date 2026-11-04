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
  const { db, env } = await getRuntime();
  // FR-ONB-5: one field per issue point and type, named seq:<branch>-<point>-<type>.
  const startingSequentials = [...form.entries()].flatMap(([name, value]) => {
    const match = /^seq:(\d{3})-(\d{3})-(\d{2})$/.exec(name);
    if (!match || typeof value !== 'string' || value.trim() === '') return [];
    // Not a whole number: NaN, which core's schema refuses.
    const next = /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
    return [{ branchCode: match[1]!, pointCode: match[2]!, documentType: match[3]! as '01', next }];
  });
  const state = await toActionState(async () => {
    const { realTenantId } = await goLive(actor, db, {
      requireAgreements: env.AGREEMENTS_ENABLED,
      startingSequentials,
    });
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
