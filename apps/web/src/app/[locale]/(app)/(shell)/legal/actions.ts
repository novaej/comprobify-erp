'use server';

import { acceptAgreements } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { requestMeta } from '@/server/request';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// FR-ONB-8: the IP address and browser are stored with the acceptance as evidence.
export async function acceptAgreementsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = form.get('locale') === 'en' ? 'en' : 'es';
  if (form.get('accept') !== 'on') return { error: 'CONFIRM_REQUIRED' };
  const { actor } = await loadShell(locale);
  const { db, agreementParties } = await getRuntime();
  if (!agreementParties) return { error: 'AGREEMENTS_DISABLED' };
  const meta = await requestMeta();
  const state = await toActionState(() =>
    acceptAgreements(
      actor,
      db,
      { ipAddress: meta.ip, userAgent: meta.headers.get('user-agent') },
      agreementParties,
    ),
  );
  if (state.done) revalidatePath(`/${locale}`, 'layout');
  return state;
}
