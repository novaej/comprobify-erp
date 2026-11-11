'use server';

import { retryFailedJob } from '@comprobify/core';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/server/actions';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

// FR-ADM-5: the operator puts a failed job back in its queue. Core checks the flag, that the job
// failed, and records the retry.
const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const localeOf = (form: FormData) => (text(form, 'locale') === 'en' ? 'en' : 'es');

export async function retryJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await loadPlatform(localeOf(form));
  const { db, jobs } = await getRuntime();
  const state = await toActionState(() =>
    retryFailedJob(actor, db, { queue: text(form, 'queue'), id: text(form, 'id') }, { jobs }),
  );
  if (state.done) revalidatePath(`/${localeOf(form)}/admin`, 'layout');
  return state;
}
